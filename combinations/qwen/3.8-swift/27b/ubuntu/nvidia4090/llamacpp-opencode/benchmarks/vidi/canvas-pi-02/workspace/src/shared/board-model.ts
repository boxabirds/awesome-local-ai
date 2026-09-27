// The board document model: Yjs schema + all mutations (story 2, board.model).
// Framework-free: the client uses it now and the Durable Object will import
// the same module for validation/migration in story 4.
//
// Schema (the future persisted and wire contract):
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map {
//     type: 'sticky'
//     x, y: number            // top-left, world units
//     color: StickyColor
//     text: Y.Text
//     z: number               // stacking; higher is on top
//     createdAt: number       // epoch ms
//   }>
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
// rejections (stale id, unknown colour, non-finite numbers, no-ops) return
// false before opening a transaction. Never throws for user-driven input.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Origin for local (this client's) transactions; undo (story 8) and
 *  echo-suppression (story 3) key off it. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

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

const SCHEMA_VERSION = 1;
const STICKY_TYPE = 'sticky';

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** The entry's Y.Map when `id` is a sticky note; undefined otherwise. */
function stickyEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== STICKY_TYPE) return undefined;
  return entry;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsMap(doc).values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

function finitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** Sets meta.schemaVersion if absent; never overwrites an existing version. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Creates a sticky note centred on `at` in the default (or given) colour and
 * returns its new id. `at` with non-finite coordinates, or an unknown colour,
 * is rejected with no transaction and the id ''.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finitePair(at.x, at.y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', STICKY_TYPE);
    entry.set('x', at.x - STICKY_SIZE_WORLD / 2);
    entry.set('y', at.y - STICKY_SIZE_WORLD / 2);
    entry.set('color', color);
    entry.set('text', new Y.Text());
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Moves a note's top-left corner to (x, y). Returns true when a change was
 * applied; false for a stale id, non-finite coordinates, or an exact no-op.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finitePair(x, y)) return false;
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  const cx = entry.get('x');
  const cy = entry.get('y');
  if (cx === x && cy === y) return false; // no-op: no pointless sync traffic
  doc.transact(() => {
    entry.set('x', x);
    entry.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raises a note above every other note. Returns true when a change was
 * applied; false for a stale id or a note already topmost (no-op).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  const z = entry.get('z');
  if (typeof z === 'number' && z >= maxZ(doc)) return false; // already topmost
  const top = maxZ(doc) + 1;
  doc.transact(() => {
    entry.set('z', top);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a note's colour. Returns true when a change was applied; false for a
 * stale id, an unknown colour name, or the note's current colour (no-op).
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const entry = stickyEntry(doc, id);
  if (!entry) return false;
  if (entry.get('color') === color) return false;
  doc.transact(() => {
    entry.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the document; false for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (objectsMap(doc).get(id) === undefined) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text, if `id` exists and is a sticky. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = stickyEntry(doc, id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id). Unknown `type`
 * values are skipped (forward compatibility for stories 9-12). The (z, id)
 * tie-break keeps every client in the same order once story 3 syncs.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of objectsMap(doc).entries()) {
    if (entry.get('type') !== STICKY_TYPE) continue;
    const text = entry.get('text');
    notes.push({
      id,
      type: STICKY_TYPE,
      x: entry.get('x') as number,
      y: entry.get('y') as number,
      color: entry.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: entry.get('z') as number,
      createdAt: entry.get('createdAt') as number,
    });
  }
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
