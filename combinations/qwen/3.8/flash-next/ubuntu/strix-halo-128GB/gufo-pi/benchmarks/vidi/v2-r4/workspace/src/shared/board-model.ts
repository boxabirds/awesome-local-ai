/**
 * The board document model: a Yjs schema plus every mutation the client (and,
 * from story 4, the Durable Object) performs. Framework-free by design.
 *
 * Schema (the future persisted and wire contract):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string /* id *\/, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking; higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections (stale id, unknown colour, non-finite coordinates, pointless
 * no-ops) return `false` before opening a transaction, so no update event is
 * emitted. The module never throws for user-driven input.
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import type { Rect } from './geometry';
import { rectContains } from './geometry';
import { readShape, type ShapeSnap } from './objects/shape';
import { readConnector, detachConnectorsTo, type ConnectorSnap } from './objects/connector';
import { readStroke, type StrokeSnap } from './objects/stroke';
import { readImage, type ImageSnap } from './objects/image';

/** Origin tag for every local mutation (story 8 undo, story 3 echo filter). */
export { LOCAL_ORIGIN } from './local-origin';
import { LOCAL_ORIGIN } from './local-origin';

export const SCHEMA_VERSION = 1;

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  width?: number;
  height?: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

export interface TextObjectSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: string;
  widthMode: 'auto' | 'fixed';
  z: number;
  createdAt: number;
  createdBy: string;
}

export type ObjectSnapshot = StickySnapshot | TextObjectSnapshot | ShapeSnap | ConnectorSnap | StrokeSnap | ImageSnap;

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** Set `meta.schemaVersion` when absent; never overwrites an existing value. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Create a sticky note centred on `at` (top-left is `at` minus half the note
 * size), on top of every existing note. Returns the new id, or `''` when the
 * point is not finite or the colour is unknown.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at.x, at.y) || !isStickyColor(color)) return '';
  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note by id. Returns false when the id is stale or a coordinate is not finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above all others (`z = maxZ + 1`). False when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  const target = maxZ(objects) + 1;
  const current = note.get('z');
  if (typeof current === 'number' && current >= target - 1) return false;
  doc.transact(() => {
    note.set('z', maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a note. Unknown colour names or stale ids return false and write nothing. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  if (note.get('color') === color) return true;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    detachConnectorsTo(doc, [id]);
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/* ---- Group operations (story 7) ---- */

/** Return the bounding rect of an object snapshot. Falls back to STICKY_SIZE_WORLD. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Return ids of objects fully inside `rect` (marquee rule: only fully-enclosed objects).
 */
export function objectsInRect(snapshotList: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshotList) {
    if (rectContains(rect, objectBounds(obj))) result.push(obj.id);
  }
  return result;
}

/**
 * Return all registered object ids (skips unknown types).
 * Currently 'sticky' is the only registered type; later stories add more.
 */
export function allObjectIds(snapshotList: readonly ObjectSnapshot[]): string[] {
  return snapshotList.map((obj) => obj.id);
}

/**
 * Move multiple objects to absolute positions.
 * Returns the number of objects moved. Skips missing ids.
 * Rejects non-finite positions; returns 0 if any are non-finite.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  if (positions.size === 0) return 0;
  const objects = objectsMap(doc);
  // Validate all positions first
  for (const pos of positions.values()) {
    if (!isFinitePoint(pos.x, pos.y)) return 0;
  }
  let count = 0;
  doc.transact(() => {
    for (const [id, pos] of positions) {
      const note = objects.get(id);
      if (!note) continue;
      note.set('x', pos.x);
      note.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Resize multiple objects to absolute rects.
 * Returns the number of objects resized. Skips missing ids.
 * Rejects non-finite rects; returns 0 if any are non-finite.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const objects = objectsMap(doc);
  // Validate all rects first
  for (const r of rects.values()) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return 0;
  }
  let count = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const note = objects.get(id);
      if (!note) continue;
      note.set('x', r.x);
      note.set('y', r.y);
      note.set('width', r.width);
      note.set('height', r.height);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Bring selected objects to front, above all unselected objects,
 * while preserving relative z-order among the selected ids.
 * Returns the number of objects whose z changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const idSet = new Set(ids);

  // Find the max z among unselected objects and collect selected entries
  let maxUnselectedZ = 0;
  const selectedEntries: Array<{ key: string; z: number }> = [];
  for (const [key, obj] of objects) {
    const z = obj.get('z');
    const zVal = typeof z === 'number' ? z : 0;
    if (idSet.has(key)) {
      selectedEntries.push({ key, z: zVal });
    } else {
      if (zVal > maxUnselectedZ) maxUnselectedZ = zVal;
    }
  }

  // Sort selected by their current z to preserve relative order
  selectedEntries.sort((a, b) => a.z - b.z);

  // Check if all selected objects are already above unselected
  const minSelectedZ = selectedEntries.length > 0 ? selectedEntries[0]!.z : Infinity;
  if (minSelectedZ > maxUnselectedZ) return 0;

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selectedEntries.length; i++) {
      const entry = selectedEntries[i]!;
      const obj = objects.get(entry.key);
      if (!obj) continue;
      const newZ = maxUnselectedZ + i + 1;
      if (obj.get('z') !== newZ) {
        obj.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete multiple objects by id.
 * Returns the number of objects deleted. Skips missing ids.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  let count = 0;
  doc.transact(() => {
    // Detach connector endpoints that reference deleted objects
    detachConnectorsTo(doc, ids);
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}

/** The shared Y.Text of a sticky note, for the text editor. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSticky(id: string, note: Y.Map<unknown>): StickySnapshot | null {
  if (note.get('type') !== 'sticky') return null;
  const text = note.get('text');
  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  const createdAt = note.get('createdAt');
  const color = note.get('color');
  const width = note.get('width');
  const height = note.get('height');
  const snap: StickySnapshot = {
    id,
    type: 'sticky',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
  if (typeof width === 'number') snap.width = width;
  if (typeof height === 'number') snap.height = height;
  return snap;
}

/**
 * An immutable list of every object (sticky + text), ordered by `(z, id)` so clients that
 * sync (story 3) still agree on stacking when concurrent edits produce equal
 * `z` values. Objects with unknown `type` values are skipped (forward
 * compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, note] of objectsMap(doc).entries()) {
    const sticky = readSticky(id, note);
    if (sticky) { out.push(sticky); continue; }
    const textObj = readTextObject(id, note);
    if (textObj) { out.push(textObj); continue; }
    const shape = readShape(id, note);
    if (shape) { out.push(shape); continue; }
    const conn = readConnector(id, note);
    if (conn) { out.push(conn); continue; }
    const stroke = readStroke(id, note);
    if (stroke) { out.push(stroke); continue; }
    const image = readImage(id, note);
    if (image) { out.push(image); continue; }
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Filter snapshot to only sticky notes (convenience for tests and code that only handles stickies). */
export function stickySnapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc).filter((o): o is StickySnapshot => o.type === 'sticky');
}

function readTextObject(id: string, obj: Y.Map<unknown>): TextObjectSnapshot | null {
  if (obj.get('type') !== 'text') return null;
  const text = obj.get('text');
  const x = obj.get('x');
  const y = obj.get('y');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const createdBy = obj.get('createdBy');
  const width = obj.get('width');
  const height = obj.get('height');
  const size = obj.get('size');
  const widthMode = obj.get('widthMode');
  return {
    id,
    type: 'text',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    width: typeof width === 'number' ? width : 60,
    height: typeof height === 'number' ? height : 26,
    text: text instanceof Y.Text ? text.toString() : '',
    size: typeof size === 'string' ? size : 'M',
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

