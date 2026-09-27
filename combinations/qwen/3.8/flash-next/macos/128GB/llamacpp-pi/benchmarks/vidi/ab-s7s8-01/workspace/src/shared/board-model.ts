// Board document model (board.model).
//
// This module owns the Yjs schema for the board and every mutation that a
// client can make to it. It is intentionally framework-free and DOM-free so
// the same code can later run inside the Durable Object (story 4) for
// validation and migration, and so the Y.Doc can be synced verbatim over the
// wire (story 3).
//
// Schema (this is the persisted + wire format):
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: string                // 'sticky' … more types from stories 9–12
//         x: number, y: number        // top-left, world units
//         width?: number, height?: number   // world units; sticky default
//                                         // STICKY_SIZE_WORLD when absent
//         color: StickyColor          // sticky only
//         text: Y.Text                // sticky only
//         z: number                   // stacking; higher is on top
//         createdAt: number           // epoch ms
//       }
//
// Object types are declared with `declareObjectType` (called by the client
// registry in `src/client/objects/registry.tsx`). Objects of an undeclared type
// stay in the document untouched but never surface in a snapshot — the
// forward-compatibility rule from story 2, now expressed per type so a board
// written by a later story is simply invisible here rather than corrupted.

import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

/** Transaction origin used for every local (user-driven) mutation. Story 8 uses
 * it for undo scoping and story 3 to avoid echoing changes back. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** The document key holding the object map. */
const OBJECTS_KEY = 'objects';
/** The document key holding board metadata. */
const META_KEY = 'meta';

/** Immutable projection of one board object used by React rendering. Sticky-only
 * fields (`color`, `text`) are optional here so one snapshot type covers every
 * object type; `StickySnapshot` narrows it for notes. */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  /** Top-left in world units. */
  readonly x: number;
  readonly y: number;
  /** Persisted size in world units. Absent means "this object's default size"
   * (sticky notes: STICKY_SIZE_WORLD) — notes created before story 7 keep their
   * size without a migration. */
  readonly width?: number;
  readonly height?: number;
  readonly z: number;
  readonly createdAt: number;
  readonly color?: StickyColor;
  readonly text?: string;
}

/** A sticky note snapshot: the object fields plus the sticky-only ones. */
export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
}

// --- Object type declaration (shared half of the client registry) ------------

/** The object types this build knows about. 'sticky' is part of the schema
 * itself; later stories add their types by calling `declareObjectType` from
 * their registry entry. */
const knownObjectTypes = new Set<string>(['sticky']);

/** Declare `type` as an object type this build can render and select.
 * Idempotent. Called by `registerObjectType` in the client registry, so a type
 * is never known to the model but unknown to the renderer (or the reverse). */
export function declareObjectType(type: string): void {
  knownObjectTypes.add(type);
}

/** True when objects of this type appear in snapshots (and can therefore be
 * selected, moved, resized and deleted). */
export function isKnownObjectType(type: string): boolean {
  return knownObjectTypes.has(type);
}

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

/** True when every number in `values` is finite (the model's contract: an
 * invalid value is refused with 0 writes and no transaction). */
function allFinite(values: readonly number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/** Create a yellow sticky note centred on `at` (top-left is `at` minus half the
 * note size), stacked on top of everything. Returns the new id.
 *
 * The size is written explicitly (story 7): new notes carry `width`/`height`,
 * notes written before the story fall back to STICKY_SIZE_WORLD. */
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
    note.set('width', STICKY_SIZE_WORLD);
    note.set('height', STICKY_SIZE_WORLD);
    note.set('color', color);
    note.set('text', text);
    note.set('z', z);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

// --- Group operations (story 7) ---------------------------------------------
//
// Every mutating call below: rejects non-finite values and empty id lists with
// `0` and NO transaction, skips ids that are not (or are no longer) in the
// document, and otherwise performs ONE LOCAL_ORIGIN transaction and returns the
// number of objects actually changed. Absolute writes (a target position/rect,
// never a delta) are what make a group gesture converge to the last writer on
// every screen when two people move the same object (design key decision 1).

/** The world-space rect of an object. Objects without a persisted size use
 * their type's default (sticky notes: STICKY_SIZE_WORLD), so notes created
 * before story 7 keep their size and become resizable with no migration. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = Number.isFinite(obj.width) && (obj.width as number) > 0 ? (obj.width as number) : STICKY_SIZE_WORLD;
  const height = Number.isFinite(obj.height) && (obj.height as number) > 0 ? (obj.height as number) : STICKY_SIZE_WORLD;
  const x = Number.isFinite(obj.x) ? obj.x : 0;
  const y = Number.isFinite(obj.y) ? obj.y : 0;
  return { x, y, width, height };
}

/** Ids of the snapshot objects lying ENTIRELY inside `rect` (the marquee rule:
 * touching or half-covered objects are not selected). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (!isKnownObjectType(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/** Ids of every selectable object on the board (Ctrl/Cmd+A). Objects whose type
 * this build does not know are skipped — they cannot be selected, moved or
 * resized, so selecting them would offer handles that do nothing. */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((obj) => isKnownObjectType(obj.type)).map((obj) => obj.id);
}

/** Move objects to absolute top-left positions. Returns how many were written;
 * missing ids are skipped (an object deleted by someone else mid-drag simply
 * stops moving). */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const objects = objectsMap(doc);
  const writes: Array<[string, Y.Map<unknown>, Point]> = [];
  for (const [id, point] of positions) {
    if (!point || !allFinite([point.x, point.y])) return 0; // invalid input: nothing moves
    const obj = objects.get(id);
    if (!obj || !isKnownObjectType(String(obj.get('type')))) continue;
    writes.push([id, obj, point]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [, obj, point] of writes) {
      obj.set('x', point.x);
      obj.set('y', point.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** Resize (and optionally move) objects to absolute rects, writing BOTH
 * `width` and `height` — the call that turns a pre-story-7 sticky note into an
 * explicitly sized one. */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const objects = objectsMap(doc);
  const writes: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, rect] of rects) {
    if (!rect || !allFinite([rect.x, rect.y, rect.width, rect.height]) || rect.width <= 0 || rect.height <= 0) {
      return 0; // invalid target: nothing is resized
    }
    const obj = objects.get(id);
    if (!obj || !isKnownObjectType(String(obj.get('type')))) continue;
    writes.push([obj, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, rect] of writes) {
      obj.set('x', rect.x);
      obj.set('y', rect.y);
      obj.set('width', rect.width);
      obj.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** Raise every object in `ids` above every object that is NOT in `ids`, keeping the
 * selected objects' relative stacking order (design key decision 4: dragging a
 * lower object must not reorder the rest of the selection).
 *
 * Two rules keep the sync traffic honest:
 *  - a selection that is already entirely above the rest writes NOTHING (raising an
 *    already-raised selection is a no-op, and their order among themselves cannot
 *    have changed);
 *  - an object that already sits above the slot it would be given keeps its z, so
 *    only the objects that really have to move are written — in ONE transaction.
 *
 * Returns how many objects were raised.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const wanted = new Set(ids);
  const selected: Array<{ id: string; obj: Y.Map<unknown>; z: number }> = [];
  let maxUnselected = -Infinity; // -Infinity when everything is selected
  objects.forEach((obj, id) => {
    if (!isKnownObjectType(String(obj.get('type')))) return;
    const z = typeof obj.get('z') === 'number' ? (obj.get('z') as number) : 0;
    if (wanted.has(id)) selected.push({ id, obj, z });
    else maxUnselected = Math.max(maxUnselected, z);
  });
  if (selected.length === 0) return 0;

  // Rank by the current stacking order (id breaks a tie identically on every
  // client, matching the snapshot sort).
  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (selected[0].z > maxUnselected) return 0; // already in front

  const writes = new Map<Y.Map<unknown>, number>();
  let nextZ = maxUnselected + 1;
  for (const entry of selected) {
    if (entry.z >= nextZ) {
      nextZ = entry.z + 1; // already above the slot it would get: keep it
      continue;
    }
    writes.set(entry.obj, nextZ);
    nextZ += 1;
  }
  if (writes.size === 0) return 0;

  doc.transact(() => {
    writes.forEach((z, obj) => obj.set('z', z));
  }, LOCAL_ORIGIN);
  return writes.size;
}

/** Remove objects. Missing ids are skipped; returns how many were deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const present = ids.filter((id) => {
    const obj = objects.get(id);
    return !!obj && isKnownObjectType(String(obj.get('type')));
  });
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

// --- Single-object helpers --------------------------------------------------
// Story 2's API, kept as thin wrappers so nothing outside this module has to
// know that the real work is generic.

/** Move a note to a new top-left. Rejects stale ids and non-finite coordinates
 * with `false` and no transaction. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!allFinite([x, y])) return false;
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
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
  return deleteObjects(doc, [id]) === 1;
}

/** The editable Y.Text for a note, or undefined for a stale/unknown id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note || !isSticky(note)) return undefined;
  return note.get('text') as Y.Text | undefined;
}

/** Project the document into an immutable, render-ready list sorted by
 * `(z, id)`, skipping objects whose type this build does not know (forward
 * compatibility) and objects with no usable position. */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const result: ObjectSnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string' || !isKnownObjectType(type)) return; // unknown / undeclared
    // Copy every field, converting Y.Text to a string. Unknown future fields
    // ride along untouched, so an object written by a later story survives a
    // round trip through this build.
    const row: Record<string, unknown> = { id, type };
    obj.forEach((value, key) => {
      row[key] = value instanceof Y.Text ? value.toString() : value;
    });
    // Position and stacking are load-bearing for rendering: fall back to 0
    // rather than handing NaN to the renderer.
    if (!Number.isFinite(row.x)) row.x = 0;
    if (!Number.isFinite(row.y)) row.y = 0;
    if (!Number.isFinite(row.z)) row.z = 0;
    if (type === 'sticky') {
      if (!Object.prototype.hasOwnProperty.call(STICKY_COLORS, String(row.color))) row.color = DEFAULT_STICKY_COLOR;
      if (typeof row.text !== 'string') row.text = '';
    }
    result.push(row as unknown as ObjectSnapshot);
  });
  // Stable render order: sort by stacking, then by id so concurrent equal z
  // values (possible once story 3 syncs) resolve identically on every client.
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
