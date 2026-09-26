// Board document model (board.model).
//
// This module owns the Yjs schema for the board and every mutation that a
// client can make to it. It is intentionally framework-free and DOM-free so
// the same code can later run inside the Durable Object (story 4) for
// validation and migration, and so the Y.Doc can be synced verbatim over the
// wire (story 3).
//
// Schema (this becomes the persisted + wire format from story 4):
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: 'sticky'
//         x: number, y: number        // top-left, world units
//         color: StickyColor
//         text: Y.Text
//         z: number                    // stacking; higher is on top
//         createdAt: number            // epoch ms
//       }

import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './config';

/** Transaction origin used for every local (user-driven) mutation. Story 8 uses
 * it for undo scoping and story 3 to avoid echoing changes back. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Immutable projection of one sticky note used by React rendering. */
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

/** The document key holding the object map. */
const OBJECTS_KEY = 'objects';
/** The document key holding board metadata. */
const META_KEY = 'meta';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** Ensure the board metadata exists. Idempotent: only writes schemaVersion when
 * it is absent, so a reloaded/shared document is never rewritten. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_KEY);
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/** Return the current highest stacking value across all objects, or 0. */
function maxZ(doc: Y.Doc): number {
  let z = 0;
  objectsMap(doc).forEach((obj) => {
    const value = obj.get('z');
    if (typeof value === 'number' && value > z) z = value;
  });
  return z;
}

function isSticky(obj: Y.Map<unknown>): boolean {
  return obj.get('type') === 'sticky';
}

/** Create a yellow sticky note centred on `at` (top-left is `at` minus half the
 * note size), stacked on top of everything. Returns the new id. */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(doc) + 1;
  const text = new Y.Text();
  const note = new Y.Map<unknown>();
  doc.transact(() => {
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', text);
    note.set('z', z);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to a new top-left. Rejects stale ids and non-finite coordinates
 * with `false` and no transaction. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note || !isSticky(note)) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note to the top (z = maxZ + 1). No-op for a stale id or when the
 * note is already topmost (avoids pointless sync traffic in story 3). */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note || !isSticky(note)) return false;
  const z = note.get('z') as number;
  const top = maxZ(doc);
  if (z >= top) return false;
  doc.transact(() => {
    note.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejects stale ids and colours outside STICKY_COLORS. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(STICKY_COLORS, color)) return false;
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note || !isSticky(note)) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note. Rejects stale ids with `false` and no transaction. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note || !isSticky(note)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The editable Y.Text for a note, or undefined for a stale/unknown id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note || !isSticky(note)) return undefined;
  return note.get('text') as Y.Text | undefined;
}

/** Project the document into an immutable, render-ready list sorted by
 * `(z, id)` and skipping unknown object types (forward compatibility). */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    if (!isSticky(obj)) return; // skip unknown types
    const color = obj.get('color') as StickyColor;
    const text = obj.get('text') as Y.Text | undefined;
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: color ?? DEFAULT_STICKY_COLOR,
      text: text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });
  // Stable render order: sort by stacking, then by id so concurrent equal z
  // values (possible once story 3 syncs) resolve identically on every client.
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}