import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * The board document model: the Yjs schema and every mutation. Framework-free
 * so the client (now) and the Durable Object (story 4) share one
 * implementation, and so the same document can be synced (story 3) and
 * persisted (story 4) without users losing notes.
 *
 * Schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 */

/** Transaction origin for local, user-driven changes (undo in story 8). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Current document schema version; migrations key off this (story 4). */
const SCHEMA_VERSION = 1;

const META_MAP = 'meta';
const OBJECTS_MAP = 'objects';

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

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(META_MAP);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

/** Write `x`/`y` only when both are finite (guards every position mutation). */
function finitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/**
 * Idempotently stamp the schema version. Called once when a document is opened
 * (client and, later, the Durable Object). A no-op when already present.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/** Highest stacking number currently in use across all objects. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsMap(doc).values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Create a sticky note centred on `at` (top-left = at − size/2), on top of
 * every other note (z = maxZ + 1). Returns the new id, or '' when the point is
 * not finite (nothing is written and no update is emitted).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finitePoint(at.x, at.y)) return '';
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to world (x, y). Rejected for a stale id or non-finite input. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finitePoint(x, y)) return false;
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  doc.transact(() => {
    entry.set('x', x);
    entry.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other note. Rejected when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  const z = entry.get('z');
  const target = maxZ(doc);
  if (typeof z === 'number' && z >= target) return false; // already topmost
  doc.transact(() => {
    entry.set('z', target + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejected for a stale id or an unknown colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  if (entry.get('color') === color) return false; // no-op: no change applied
  doc.transact(() => {
    entry.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note. Rejected (false, no update) for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or undefined for a stale / non-sticky id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable view of every sticky note, sorted by (z, id) so equal z values
 * (possible once story 3 syncs) still give every client the same order. Objects
 * of unknown `type` are skipped for forward compatibility (stories 9–12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of objectsMap(doc)) {
    if (entry.get('type') !== 'sticky') continue;
    const color = entry.get('color');
    const text = entry.get('text');
    notes.push({
      id,
      type: 'sticky',
      x: numberOr(entry.get('x'), 0),
      y: numberOr(entry.get('y'), 0),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: numberOr(entry.get('z'), 0),
      createdAt: numberOr(entry.get('createdAt'), 0),
    });
  }
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
