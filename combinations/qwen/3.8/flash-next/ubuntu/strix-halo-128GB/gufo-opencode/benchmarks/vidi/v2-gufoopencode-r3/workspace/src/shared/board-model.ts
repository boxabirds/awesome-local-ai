import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
// Runtime cycle with objects/connector.ts is safe: both sides only call into
// each other from inside function bodies, never during module evaluation.
import { collectConnectorBBoxes, detachConnectorsTo } from './objects/connector';

// Origin tag for every local mutation. Story 8 uses it for undo and story 3
// uses it to avoid echoing local changes back over the network.
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export const SCHEMA_VERSION = 1;

// Base fields every object type stores: identity, position, stacking and the
// optional persisted size (story 7; implicit size falls back to
// STICKY_SIZE_WORLD, no migration).
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width?: number;
  readonly height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
  readonly createdAt: number;
}

const META = 'meta';
const OBJECTS = 'objects';

// Object types the UI may select, move and delete. The client registry
// (src/client/objects/registry.tsx) adds real types at import time;
// documents may contain unknown types (forward compatibility), which stay
// invisible to selection.
const SELECTABLE_TYPES = new Set<string>(['sticky']);

export function registerSelectableType(type: string): void {
  SELECTABLE_TYPES.add(type);
}

function isSelectableType(type: string): boolean {
  return SELECTABLE_TYPES.has(type);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function finitePoint(at: { x: number; y: number }): boolean {
  return Number.isFinite(at.x) && Number.isFinite(at.y);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS);
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR
): string {
  if (!finitePoint(at)) {
    // Non-finite input is a programming error, never user-driven input;
    // reject loudly so bugs surface instead of corrupting the document.
    throw new TypeError(`createSticky: coordinates must be finite, got (${at.x}, ${at.y})`);
  }
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

function readDimension(obj: Y.Map<unknown>, key: 'width' | 'height'): number | undefined {
  const value = obj.get(key);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Generic group operations (story 7). Every mutating call rejects non-finite
// values and empty id lists with 0 and no transaction, skips missing ids and
// otherwise applies one LOCAL_ORIGIN transaction, returning the count changed.
// ---------------------------------------------------------------------------

export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD
  };
}

// Marquee rule: an object is selected only when its whole bounds lie inside
// the rectangle. Unknown types are never selectable.
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect
): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (!isSelectableType(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (isSelectableType(obj.type)) ids.push(obj.id);
  }
  return ids;
}

export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const targets: Array<[Y.Map<unknown>, Point]> = [];
  for (const [id, p] of positions) {
    const obj = objectsMap(doc).get(id);
    if (obj === undefined) continue; // deleted mid-gesture: skipped
    if (obj.get('x') === p.x && obj.get('y') === p.y) continue;
    targets.push([obj, p]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, p] of targets) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height) ||
      r.width <= 0 ||
      r.height <= 0
    ) {
      return 0;
    }
  }
  const targets: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    const obj = objectsMap(doc).get(id);
    if (obj === undefined) continue;
    if (
      obj.get('x') === r.x &&
      obj.get('y') === r.y &&
      obj.get('width') === r.width &&
      obj.get('height') === r.height
    ) {
      continue;
    }
    targets.push([obj, r]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of targets) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      // The first resize turns an implicit-size object explicit.
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

// Raises every selected object above all unselected objects while keeping the
// relative stacking order among selected ones (z = maxUnselectedZ + rank).
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const map = objectsMap(doc);
  const present = new Set(unique);
  const selected: Array<{ obj: Y.Map<unknown>; z: number }> = [];
  for (const id of unique) {
    const obj = map.get(id);
    if (obj === undefined) continue;
    const z = obj.get('z');
    selected.push({ obj, z: typeof z === 'number' ? z : 0 });
  }
  if (selected.length === 0) return 0;
  let maxUnselected = 0;
  for (const [id, obj] of map) {
    if (present.has(id)) continue;
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxUnselected) maxUnselected = z;
  }
  selected.sort((a, b) => a.z - b.z);
  const writes: Array<[Y.Map<unknown>, number]> = [];
  selected.forEach((entry, rank) => {
    const next = maxUnselected + rank + 1;
    if (entry.z !== next) writes.push([entry.obj, next]);
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, z] of writes) obj.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objectsMap(doc);
  const present = [...new Set(ids)].filter((id) => map.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Arrows attached to doomed objects detach to free points in this same
    // transaction, so the delete is one update and one undo step (story 10).
    detachConnectorsTo(doc, present);
    for (const id of present) map.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

// Story 2 single-object operations as thin wrappers over the group versions.

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (obj === undefined) return false;
  if (obj.get('color') === color) return false; // no-op → false per contract
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

// Render-time fields for a sticky that is not in the sticky snapshot (the
// generic renderer receives only ObjectSnapshot position/size fields).
export function getStickyFields(
  doc: Y.Doc,
  id: string
): { color: StickyColor; text: string } | undefined {
  const obj = stickyMap(doc, id);
  if (obj === undefined) return undefined;
  const color = obj.get('color');
  const text = obj.get('text');
  if (!isStickyColor(color) || !(text instanceof Y.Text)) return undefined;
  return { color, text: text.toString() };
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  const text = obj?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function byZThenId(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Every structurally valid object of every type, for generic rendering and
// group operations. Invalid objects are skipped (forward compatibility).
export function snapshotAll(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  // Connectors store no geometry of their own (x/y/z of 0); their bounds are
  // derived from the live endpoints so selection, marquee and undo all see
  // the real arrow extent (story 10).
  const connectorBoxes = collectConnectorBBoxes(doc);
  for (const [id, obj] of objectsMap(doc)) {
    const type = obj.get('type');
    if (type === 'connector') {
      const r = connectorBoxes.get(id);
      if (r === undefined) continue; // invalid endpoints: invisible
      const z = obj.get('z');
      if (typeof z !== 'number' || !Number.isFinite(z)) continue;
      objects.push({ id, type, x: r.x, y: r.y, z, width: r.width, height: r.height });
      continue;
    }
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    if (
      typeof type !== 'string' ||
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      typeof y !== 'number' ||
      !Number.isFinite(y) ||
      typeof z !== 'number' ||
      !Number.isFinite(z)
    ) {
      continue;
    }
    const width = readDimension(obj, 'width');
    const height = readDimension(obj, 'height');
    objects.push({
      id,
      type,
      x,
      y,
      z,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {})
    });
  }
  objects.sort(byZThenId);
  return objects;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'sticky') continue; // forward compatibility
    const x = obj.get('x');
    const y = obj.get('y');
    const color = obj.get('color');
    const text = obj.get('text');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !isStickyColor(color) ||
      !(text instanceof Y.Text) ||
      typeof z !== 'number' ||
      typeof createdAt !== 'number'
    ) {
      continue;
    }
    const width = readDimension(obj, 'width');
    const height = readDimension(obj, 'height');
    notes.push({
      id,
      type: 'sticky',
      x,
      y,
      z,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      color,
      text: text.toString(),
      createdAt
    });
  }
  notes.sort(byZThenId);
  return notes;
}
