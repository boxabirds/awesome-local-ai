/**
 * Story 2 · the board document model (design "Board document model").
 *
 * A framework-free module that owns every mutation of the shared document. It
 * is written against a real `Y.Doc` so the exact same code will, in story 3,
 * be synced between people and, in story 4, persisted by the Durable Object —
 * hence `meta.schemaVersion` and the transaction origin.
 *
 * Document schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 *
 * The module never throws for user-driven input: a stale id, an unknown colour
 * or a non-finite coordinate returns `false` and opens no transaction (so no
 * pointless update / sync traffic). A successful mutation is exactly one
 * `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/**
 * Transaction origin for local edits. Story 8's undo manager and story 3's
 * provider distinguish local from remote changes by origin, so every local
 * mutation is tagged with this single symbol.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** An immutable view of one sticky note, safe to hand to React. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

type StickyRecord = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<StickyRecord> {
  return doc.getMap<StickyRecord>(OBJECTS_KEY);
}

function isSticky(record: StickyRecord | undefined): record is StickyRecord {
  return record !== undefined && record.get('type') === 'sticky';
}

/** Highest `z` currently in the document (0 when empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objects(doc).forEach((record) => {
    if (!isSticky(record)) return;
    const z = record.get('z');
    if (typeof z === 'number' && z > top) top = z;
  });
  return top;
}

function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** A stable identifier. Falls back where `crypto.randomUUID` is unavailable. */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for exotic runtimes; still effectively unique.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Ensure the document metadata exists (idempotent: only writes once). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (the top-left is `at` minus half the
 * note size), on top of every other note (z = maxZ + 1). Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const id = newId();
  const top = maxZ(doc) + 1;
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - half);
    note.set('y', at.y - half);
    note.set('color', color);
    note.set('text', new Y.Text(''));
    note.set('z', top);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note to world `(x, y)`. Returns false (no transaction) for a stale
 * id or a non-finite coordinate.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  if (!finite(x, y)) return false;
  if (record.get('x') === x && record.get('y') === y) return false;
  doc.transact(() => {
    record.set('x', x);
    record.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note to the front. Returns false (no transaction) for a stale id or
 * a note that is already the topmost — avoiding pointless sync traffic later.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  const current = record.get('z');
  if (typeof current !== 'number') return false;
  const top = maxZ(doc);
  if (current >= top) return false;
  doc.transact(() => {
    record.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour. Rejects an unknown colour name and a no-op recolour
 * (already that colour), returning false without a transaction.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  if (!Object.prototype.hasOwnProperty.call(STICKY_COLORS, color)) return false;
  if (record.get('color') === color) return false;
  doc.transact(() => {
    record.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);
  return true;
}

/** Delete a note. Returns false (no transaction) for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  if (!map.has(id)) return false;
  doc.transact(() => {
    map.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's `Y.Text`, or undefined if the id is missing or not a note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return undefined;
  return record.get('text') as Y.Text | undefined;
}

/**
 * A plain, immutable snapshot of every note, ordered by `(z, id)` so the
 * render order is deterministic even once equal `z` values appear after a
 * story-3 merge. Unknown `type` values are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objects(doc).forEach((record, id) => {
    if (!isSticky(record)) return;
    const text = record.get('text');
    result.push({
      id,
      type: 'sticky',
      x: record.get('x') as number,
      y: record.get('y') as number,
      color: record.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: record.get('z') as number,
      createdAt: record.get('createdAt') as number,
    });
  });
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}