import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor, TEXT_SIZES, type TextSize } from './config';
import { rectContains, type Rect, type Point } from './geometry';
import type { TextSnapshot } from './objects/text';

// Origin used for all local transactions (story 8 undo and story 3 echo suppression).
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/**
 * Type-agnostic board object (story 7). `width`/`height` are optional:
 * stickies created before story 7 omit them and render at STICKY_SIZE_WORLD
 * (the first resize writes both fields).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

// Board-model-known object types. The client registry registers its types
// here (registerObjectType → registerKnownType) so the worker-safe shared
// model never imports client code.
const KNOWN_TYPES = new Set<string>(['sticky']);

/** Marks `type` as a known board-object type (idempotent). */
export function registerKnownType(type: string): void {
  KNOWN_TYPES.add(type);
}

/** True when the board model knows how to snapshot/mutate this type. */
export function isKnownType(type: string): boolean {
  return KNOWN_TYPES.has(type);
}

/** Bounds of an object in world units (implicit sticky size when width/height absent). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of the objects lying entirely inside `rect` (marquee rule). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/** Ids of the snapshot's objects of known types (select-all). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (isKnownType(obj.type)) ids.push(obj.id);
  }
  return ids;
}

function isValidPoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Sets the top-left corner of each listed object to the given world position
 * (absolute writes). Non-finite values → 0, no transaction; missing ids
 * skipped; one LOCAL_ORIGIN transaction. Returns the count of objects changed.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isValidPoint(p)) return 0;
  }
  const objs = objects(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, p] of positions) {
      const obj = objs.get(id);
      if (!obj || !isKnownType(obj.get('type') as string)) continue;
      obj.set('x', p.x);
      obj.set('y', p.y);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Sets each listed object's rect (x, y, width, height) — turning implicit-size
 * stickies explicit. Same rules as moveObjects. Returns the count changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) {
      return 0;
    }
  }
  const objs = objects(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const obj = objs.get(id);
      if (!obj || !isKnownType(obj.get('type') as string)) continue;
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Raises the listed objects above every unselected object, preserving their
 * relative stacking order (z = maxUnselectedZ + rank). Returns the count raised.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objs = objects(doc);
  const selected = new Set(ids);
  let maxUnselectedZ = 0;
  const selEntries: { id: string; z: number }[] = [];
  objs.forEach((obj, id) => {
    const z = obj.get('z');
    if (typeof z !== 'number' || !Number.isFinite(z)) return;
    if (selected.has(id)) selEntries.push({ id, z });
    else if (z > maxUnselectedZ) maxUnselectedZ = z;
  });
  if (selEntries.length === 0) return 0;
  // Preserve current relative order (same (z, id) tie-break as snapshots).
  selEntries.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : 1) : a.z - b.z));
  doc.transact(() => {
    selEntries.forEach((entry, i) => {
      const obj = objs.get(entry.id);
      if (obj) obj.set('z', maxUnselectedZ + i + 1);
    });
  }, LOCAL_ORIGIN);
  return selEntries.length;
}

/** Removes the listed objects. Missing ids skipped. Returns the count removed. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objs = objects(doc);
  let count = 0;
  doc.transact(() => {
    for (const id of ids) {
      const obj = objs.get(id);
      if (!obj) continue;
      objs.delete(id);
      count += 1;
    }
  }, LOCAL_ORIGIN);
  return count;
}

const SCHEMA_VERSION = 1;

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function isSticky(obj: ObjectMap): boolean {
  return obj.get('type') === 'sticky';
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Sets meta.schemaVersion (if absent) and ensures the objects map exists.
 * Idempotent.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
  objects(doc);
}

/**
 * Creates a yellow (or given colour) sticky note centred on `at` (world units),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or false for
 * non-finite coordinates.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
  if (!(color in STICKY_COLORS)) return false;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note's top-left to (x, y) world units. False for stale ids / non-finite coords. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises a note to the top of the stack. False if already topmost or stale. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  const z = obj.get('z');
  if (typeof z !== 'number' || z >= maxZ(doc)) return false;
  doc.transact(() => {
    obj.set('z', maxZ(doc) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets a note's colour to one of the six presets. False for unknown colours / stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes a note. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  doc.transact(() => {
    objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the Y.Text of a note, or undefined for stale / non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of every known board object, sorted by (z, id) so
 * concurrent equal z values (story 3) give every client the same order.
 * Unknown types are skipped (forward compatibility for stories 9–12).
 * Sticky entries carry their full sticky fields (see StickySnapshot).
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const result: ObjectSnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    const type = obj.get('type');
    if (typeof type !== 'string' || !isKnownType(type)) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    const entry: ObjectSnapshot = { id, type, x, y, z };
    const width = obj.get('width');
    const height = obj.get('height');
    if (typeof width === 'number' && Number.isFinite(width)) entry.width = width;
    if (typeof height === 'number' && Number.isFinite(height)) entry.height = height;
    if (type === 'sticky') {
      const color = obj.get('color');
      if (typeof color !== 'string' || !(color in STICKY_COLORS)) return;
      const text = obj.get('text');
      const createdAt = obj.get('createdAt');
      (entry as StickySnapshot).color = color as StickyColor;
      (entry as StickySnapshot).text = text instanceof Y.Text ? text.toString() : '';
      (entry as StickySnapshot).createdAt = typeof createdAt === 'number' ? createdAt : 0;
    } else if (type === 'text') {
      const size = obj.get('size');
      if (typeof size !== 'string' || !(size in TEXT_SIZES)) return;
      const text = obj.get('text');
      const widthMode = obj.get('widthMode');
      const createdAt = obj.get('createdAt');
      const createdBy = obj.get('createdBy');
      (entry as TextSnapshot).text = text instanceof Y.Text ? text.toString() : '';
      (entry as TextSnapshot).size = size as TextSize;
      (entry as TextSnapshot).widthMode = widthMode === 'fixed' ? 'fixed' : 'auto';
      (entry as TextSnapshot).createdAt = typeof createdAt === 'number' ? createdAt : 0;
      (entry as TextSnapshot).createdBy = typeof createdBy === 'string' ? createdBy : '';
    }
    result.push(entry);
  });
  result.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return result;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent equal
 * z values (story 3) still give every client the same order. Unknown types are
 * skipped (forward compatibility for stories 9–12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objectSnapshot(doc).filter((o): o is StickySnapshot => o.type === 'sticky');
}
