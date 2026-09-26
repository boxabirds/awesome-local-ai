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
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './config';
import type { Rect } from './geometry';
import { isFiniteRect } from './geometry';
import { getObjectType } from './object-types';

/** Transaction origin used for every local (user-driven) mutation. Story 8 uses
 * it for undo scoping and story 3 to avoid echoing changes back. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Immutable projection of one sticky note used by React rendering. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  /** Footprint in world units. Notes created before story 7 carry no explicit
   * size and fall back to `STICKY_SIZE_WORLD` (compatibility requirement). */
  width: number;
  height: number;
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

/** True for any object whose type is registered, i.e. anything the generic
 * story-7 operations (select, move, resize, delete, raise) may act on. Keeping
 * this registry-driven instead of `type === 'sticky'` is what lets a later
 * object type reuse the gestures unchanged (contract sel.all_types). */
function isSelectable(obj: Y.Map<unknown>): boolean {
  return getObjectType(obj.get('type') as string | undefined) !== undefined;
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

// --- Group operations (story 7) ---------------------------------------------
//
// Group transforms act on a set of ids at once and always run inside a single
// transaction so one gesture is one undo step. Every one of them is silent and
// side-effect free for an empty group, an unknown id or a malformed rectangle,
// and none of them can leave a negative width/height in the document.

/** The footprint of an object for selection and hit testing. Only known types
 * are selectable; a future shape with only x/y is skipped here (see
 * `objectsInRect`) so it can never be half-resized. */
/** The footprint of an object for selection and hit testing. Only known types
 * are selectable; a future shape with only x/y is skipped here (see
 * `objectsInRect`) so it can never be half-resized. A sticky keeps an explicit
 * `width`/`height` once it has been resized; before that it is `STICKY_SIZE_WORLD`. */
export function objectBounds(doc: Y.Doc, id: string): Rect | null {
  const obj = objectsMap(doc).get(id);
  if (!obj || !isSelectable(obj)) return null;
  const x = obj.get('x');
  const y = obj.get('y');
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const width = typeof obj.get('width') === 'number' ? (obj.get('width') as number) : STICKY_SIZE_WORLD;
  const height = typeof obj.get('height') === 'number' ? (obj.get('height') as number) : STICKY_SIZE_WORLD;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** Read one object's footprint straight from its Y.Map (used by `snapshot`). */
function boundsOf(obj: Y.Map<unknown>): { width: number; height: number } | null {
  const width = typeof obj.get('width') === 'number' ? (obj.get('width') as number) : STICKY_SIZE_WORLD;
  const height = typeof obj.get('height') === 'number' ? (obj.get('height') as number) : STICKY_SIZE_WORLD;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Ids of every selectable object (currently the sticky notes). Unknown types
 * are skipped so a future shape is never moved/resized before it is registered. */
export function allObjectIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  objectsMap(doc).forEach((obj, id) => {
    if (isSelectable(obj)) ids.push(id);
  });
  return ids;
}

/** Ids of selectable objects whose footprint overlaps `rect` (Shift+drag marquee).
 * Bounds + intersection are plain number math, so this is unit-testable against a
 * Y.Doc without a DOM. */
/** Ids of selectable objects lying ENTIRELY inside `rect` (Shift+drag marquee).
 * An object that is only partly inside is deliberately NOT selected: that is the
 * observable difference between a marquee and a lasso, and both the PRD and the
 * e2e fixture depend on it. Bounds + containment are plain number math, so this
 * is unit-testable against a Y.Doc without a DOM. */
export function objectsInRect(doc: Y.Doc, rect: Rect): string[] {
  const ids: string[] = [];
  if (!isFiniteRect(rect)) return ids;
  objectsMap(doc).forEach((obj, id) => {
    if (!isSelectable(obj)) return; // skip unknown types
    const b = objectBounds(doc, id);
    if (!b) return;
    const inside =
      b.x >= rect.x &&
      b.y >= rect.y &&
      b.x + b.width <= rect.x + rect.width &&
      b.y + b.height <= rect.y + rect.height;
    if (inside) ids.push(id);
  });
  return ids;
}

/** Move every sticky in `ids` by the same delta, in ONE transaction. A non-finite
 * delta or an empty group changes nothing. Returns the number of objects moved
 * (the count of *valid* ids, so a stale id does not produce an update). */
export function moveObjects(doc: Y.Doc, ids: readonly string[], dx: number, dy: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return 0;
  const objects = objectsMap(doc);
  const targets: Y.Map<unknown>[] = [];
  for (const id of ids) {
    const note = objects.get(id);
    if (note !== undefined && isSelectable(note)) targets.push(note);
  }
  if (targets.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    for (const note of targets) {
      const x = note.get('x');
      const y = note.get('y');
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      note.set('x', x + dx);
      note.set('y', y + dy);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/** Remove several objects in one transaction. Missing ids are skipped. Returns
 * the number actually deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const present = ids.filter((id) => {
    const note = objects.get(id);
    return note !== undefined && isSelectable(note);
  });
  if (present.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    for (const id of present) {
      objects.delete(id);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/** Resize sticky notes to new bounds, clamping each side into
 * [STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD]. A rect whose clamped size is
 * below the minimum is dropped (never written), so the document cannot end up
 * with a negative or sub-minimum size. `items` maps an id to its new rect. */
export function resizeObjects(doc: Y.Doc, items: ReadonlyMap<string, Rect>): number {
  const objects = objectsMap(doc);
  const writes: { note: Y.Map<unknown>; x: number; y: number; w: number; h: number }[] = [];
  for (const [id, rect] of items) {
    const note = objects.get(id);
    if (!note || !isSelectable(note)) continue;
    if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) continue;
    let w = rect.width;
    let h = rect.height;
    if (w < STICKY_MIN_SIZE_WORLD || h < STICKY_MIN_SIZE_WORLD) continue;
    if (w > MAX_OBJECT_SIZE_WORLD) w = MAX_OBJECT_SIZE_WORLD;
    if (h > MAX_OBJECT_SIZE_WORLD) h = MAX_OBJECT_SIZE_WORLD;
    writes.push({ note, x: rect.x, y: rect.y, w, h });
  }
  if (writes.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    for (const item of writes) {
      item.note.set('x', item.x);
      item.note.set('y', item.y);
      item.note.set('width', item.w);
      item.note.set('height', item.h);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/** Raise every object in `ids` above every object that is not selected, in ONE
 * transaction, while PRESERVING the relative stacking order inside the group
 * (contract `sel.group_move`). Objects already on top are left alone, so a
 * no-op drag does not emit an update. Returns the number of objects raised. */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const group: Y.Map<unknown>[] = [];
  let raised = 0;
  for (const id of ids) {
    const obj = objects.get(id);
    if (obj !== undefined && isSelectable(obj)) group.push(obj);
  }
  if (group.length === 0) return 0;
  doc.transact(() => {
    // Highest z outside the group: the group must land above this.
    let outside = 0;
    objectsMap(doc).forEach((obj) => {
      if (!isSelectable(obj) || group.includes(obj)) return;
      const z = obj.get('z');
      if (typeof z === 'number' && z > outside) outside = z;
    });
    const below = Math.min(...group.map((o) => (typeof o.get('z') === 'number' ? (o.get('z') as number) : 0)));
    // Nothing to do when the group already sits above every other object.
    if (group.length === objects.size || below > outside) return;
    // Lift by a constant offset: relative order inside the group is untouched.
    const shift = outside + 1 - below;
    for (const obj of group) {
      const z = obj.get('z');
      if (typeof z === 'number') obj.set('z', z + shift);
    }
    raised = group.length;
  }, LOCAL_ORIGIN);
  return raised;
}

/** Project the document into an immutable, render-ready list sorted by
 * `(z, id)` and skipping unknown object types (forward compatibility). */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    if (!isSelectable(obj)) return; // skip unknown types
    const color = obj.get('color') as StickyColor;
    const text = obj.get('text') as Y.Text | undefined;
    const size = boundsOf(obj);
    if (!size) return; // a malformed footprint renders nothing at all
    result.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: size.width,
      height: size.height,
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