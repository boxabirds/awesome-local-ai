// Yjs board schema and every board mutation. Framework-free so the Durable
// Object (story 4) can import it for validation/migration.
//
// Schema:
//   Y.Doc
//     meta: Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string, Y.Map> with { type:'sticky', x, y, color, text: Y.Text, z, createdAt }

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

// Generic object fields shared by every object type (stories 9-12 add more).
// width/height are absent on stickies created before story 7; readers fall
// back to STICKY_SIZE_WORLD.
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

// Types the model knows how to snapshot. Stories 9-12 extend this through
// the client object registry; unknown types stay invisible until registered.
const knownTypes = new Set<string>(['sticky']);

export function markTypeKnown(type: string): void {
  knownTypes.add(type);
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', 1);
  }, LOCAL_ORIGIN);
}

// Places the note's top-left so the note is centred on `at`.
// Returns the new id, or false for non-finite coordinates.
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFinitePoint(at)) return false;
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', new Y.Text(''));
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

// Render order: (z, id). Sorting by id as a tie-break keeps every client's
// order identical once story 3 syncs concurrent equal-z notes. Unknown types
// are skipped for forward compatibility with stories 9-12.
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'sticky') continue;
    const color = obj.get('color');
    const text = obj.get('text');
    const width = obj.get('width');
    const height = obj.get('height');
    const snap: StickySnapshot = {
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    };
    if (typeof width === 'number') snap.width = width;
    if (typeof height === 'number') snap.height = height;
    notes.push(snap);
  }
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

// --- Story 7: generic group operations ------------------------------------

// Bounds of any object snapshot; stickies predating story 7 have no
// width/height and read as STICKY_SIZE_WORLD.
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

// ids of objects fully inside `rect` (marquee rule: all four edges inside).
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

// ids for select-all; snapshots never carry unregistered types.
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

// One transaction writing absolute positions. Any non-finite coordinate
// rejects the whole call (nothing is written); missing ids are skipped.
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const objects = objectsMap(doc);
  const writes: [Y.Map<unknown>, Point][] = [];
  for (const [id, p] of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
    const obj = objects.get(id);
    if (!obj) continue;
    writes.push([obj, p]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, p] of writes) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

// One transaction writing absolute rects. Any non-finite field rejects the
// whole call; missing ids are skipped. The first write also persists
// width/height, making later reads no longer fall back to the implicit size.
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const objects = objectsMap(doc);
  const writes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      return 0;
    }
    const obj = objects.get(id);
    if (!obj) continue;
    writes.push([obj, r]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of writes) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

// Raises the ids above every unselected object while preserving their
// relative z: selected objects are sorted by (z, id) and get
// maxUnselectedZ + rank (1-based). Returns how many z values changed.
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const wanted = new Set(ids);
  let maxUnselected = 0;
  const selected: [string, Y.Map<unknown>, number][] = [];
  for (const [id, obj] of objects) {
    const z = obj.get('z');
    const zn = typeof z === 'number' ? z : 0;
    if (wanted.has(id)) {
      selected.push([id, obj, zn]);
    } else if (zn > maxUnselected) {
      maxUnselected = zn;
    }
  }
  if (selected.length === 0) return 0;
  selected.sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const changes: [Y.Map<unknown>, number][] = [];
  selected.forEach(([, obj, z], index) => {
    const target = maxUnselected + index + 1;
    if (z !== target) changes.push([obj, target]);
  });
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, z] of changes) obj.set('z', z);
  }, LOCAL_ORIGIN);
  return changes.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present = ids.filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

// Generic snapshot for the story 7 UI: every registered type, sorted by
// (z, id). Stickies keep their colour and text; other registered types use
// the generic fields. Replaces `snapshot` for rendering, selection and the
// marquee; `snapshot` remains the sticky-only view used by test hooks.
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    const type = obj.get('type');
    if (typeof type !== 'string' || !knownTypes.has(type)) continue;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    const width = obj.get('width');
    const height = obj.get('height');
    const base: ObjectSnapshot = {
      id,
      type,
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    };
    if (typeof width === 'number') base.width = width;
    if (typeof height === 'number') base.height = height;
    if (type === 'sticky') {
      const color = obj.get('color');
      const text = obj.get('text');
      const sticky: StickySnapshot = {
        ...base,
        type: 'sticky',
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
      };
      out.push(sticky);
    } else {
      out.push(base);
    }
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
