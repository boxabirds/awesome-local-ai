// Board document model: the Yjs schema and every mutation on it.
// Framework-free so the Durable Object (story 4) can import it too.
//
// Y.Doc
//   meta:    Y.Map { schemaVersion }
//   objects: Y.Map<id, Y.Map { type, x, y, width?, height?, color, text: Y.Text, z, createdAt }>
//
// width/height were added by story 7; notes created before it have neither and
// render at STICKY_SIZE_WORLD until their first resize writes both.
import * as Y from 'yjs';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { isFiniteRect, rectContains, type Point, type Rect } from './geometry';

/** Transaction origin for every local mutation (story 8 undo, story 3 echo filtering). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** The fields every board object has (story 7): what selection, move and resize use. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Width in world units (STICKY_SIZE_WORLD when not stored). */
  width: number;
  /** Height in world units (STICKY_SIZE_WORLD when not stored). */
  height: number;
  z: number;
  createdAt: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export function isSticky(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

/** Object types this model reads; anything else in the doc is ignored. */
const KNOWN_TYPES = new Set<string>(['sticky']);

/** Adds a type's own fields to the common snapshot (story 9 text). */
export type ModelTypeReader = (base: ObjectSnapshot, obj: Y.Map<unknown>) => ObjectSnapshot;

const READERS = new Map<string, ModelTypeReader>();

/**
 * Derives a snapshot's geometry from other objects (story 10 connectors: the
 * bbox follows the objects the ends are attached to). `rects` holds every
 * non-derived object's rect, in (z, id) order.
 */
export type ModelTypeDeriver = (snap: ObjectSnapshot, rects: ReadonlyMap<string, Rect>) => ObjectSnapshot;

const DERIVERS = new Map<string, ModelTypeDeriver>();

/** Runs inside every `deleteObjects` transaction, before the objects are removed (story 10). */
export type DeleteHook = (doc: Y.Doc, deletedIds: string[]) => void;

const DELETE_HOOKS = new Set<DeleteHook>();

export function registerDeleteHook(hook: DeleteHook): void {
  DELETE_HOOKS.add(hook);
}

/**
 * Declares an object type readable by `objectsSnapshot`, `allObjectIds` and
 * `objectsInRect`. Called by the client object registry (story 7) and by
 * type modules with a `read` that adds the type's own fields; idempotent (a
 * later call without `read` keeps an earlier reader).
 */
export function registerModelType(type: string, read?: ModelTypeReader, derive?: ModelTypeDeriver): void {
  KNOWN_TYPES.add(type);
  if (read) READERS.set(type, read);
  if (derive) DERIVERS.set(type, derive);
}

const HALF = 2;

function meta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return objects(doc);
}

export function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objects(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return isFiniteNumber(z) ? z : 0;
}

export function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    max = Math.max(max, zOf(obj));
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  if (meta(doc).has('schemaVersion')) return;
  doc.transact(() => {
    meta(doc).set('schemaVersion', BOARD_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), on top of all objects.
 * Returns the new id, or '' when `at` is not finite (nothing written).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    obj.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    obj.set('width', STICKY_SIZE_WORLD);
    obj.set('height', STICKY_SIZE_WORLD);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Sets an object's top-left position. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Raises an object above all others. No-op (false) when already strictly topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

// ---------------------------------------------------------------------------
// Story 7 — generic group operations. Each mutating call rejects non-finite
// input or an empty list (0, no transaction), skips missing ids, and otherwise
// writes everything in one LOCAL_ORIGIN transaction, returning the count changed.

/**
 * Sets absolute top-left positions. Absolute (not incremental) so concurrent
 * moves of the same object converge to the last writer on every screen.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  for (const p of positions.values()) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
  }
  const changes: [Y.Map<unknown>, Point][] = [];
  for (const [id, p] of positions) {
    const obj = getObject(doc, id);
    if (!obj || (obj.get('x') === p.x && obj.get('y') === p.y)) continue;
    changes.push([obj, p]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, p] of changes) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Sets absolute rects (position and size); always writes both width and height. */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const r of rects.values()) {
    if (!isFiniteRect(r) || !(r.width > 0) || !(r.height > 0)) return 0;
  }
  const changes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    const obj = getObject(doc, id);
    if (!obj) continue;
    if (
      obj.get('x') === r.x &&
      obj.get('y') === r.y &&
      obj.get('width') === r.width &&
      obj.get('height') === r.height
    ) {
      continue;
    }
    changes.push([obj, r]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of changes) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

function byZThenId(a: [string, Y.Map<unknown>], b: [string, Y.Map<unknown>]): number {
  return zOf(a[1]) - zOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/**
 * Raises the given objects above every other object, keeping their stacking
 * order among themselves (z = max unselected z + rank). 0 when they already
 * all sit strictly above the rest.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const wanted = new Set(ids);
  const selected: [string, Y.Map<unknown>][] = [];
  let maxOther = -Infinity;
  objects(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    if (wanted.has(id)) selected.push([id, obj]);
    else maxOther = Math.max(maxOther, zOf(obj));
  });
  if (selected.length === 0) return 0;
  if (maxOther === -Infinity) maxOther = 0;
  selected.sort(byZThenId);
  if (zOf(selected[0][1]) > maxOther) return 0;
  const changes: [Y.Map<unknown>, number][] = [];
  selected.forEach(([, obj], rank) => {
    const z = maxOther + rank + 1;
    if (obj.get('z') !== z) changes.push([obj, z]);
  });
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, z] of changes) obj.set('z', z);
  }, LOCAL_ORIGIN);
  return changes.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = [...new Set(ids)].filter((id) => objects(doc).has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Story 10: arrows attached to these objects keep their ends where they were.
    for (const hook of DELETE_HOOKS) hook(doc, present);
    for (const id of present) objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * An object's rect in world units (implicit STICKY_SIZE_WORLD for legacy notes).
 * A zero size is kept: a horizontal or vertical arrow's box (story 10) is flat.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = (obj as Partial<ObjectSnapshot>).width;
  const height = (obj as Partial<ObjectSnapshot>).height;
  return {
    x: obj.x,
    y: obj.y,
    width: isFiniteNumber(width) && width >= 0 ? width : STICKY_SIZE_WORLD,
    height: isFiniteNumber(height) && height >= 0 ? height : STICKY_SIZE_WORLD,
  };
}

/** Rects of every object whose geometry is stored (not derived), in list order. */
export function storedRects(list: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of list) if (!DERIVERS.has(o.type)) rects.set(o.id, objectBounds(o));
  return rects;
}

/** Ids of known-type objects lying entirely inside `rect` (marquee rule). */
export function objectsInRect(list: readonly ObjectSnapshot[], rect: Rect): string[] {
  return list.filter((o) => KNOWN_TYPES.has(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every known-type object (select all). */
export function allObjectIds(list: readonly ObjectSnapshot[]): string[] {
  return list.filter((o) => KNOWN_TYPES.has(o.type)).map((o) => o.id);
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function toObject(id: string, obj: Y.Map<unknown>): ObjectSnapshot | null {
  const type = obj.get('type');
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null;
  const x = obj.get('x');
  const y = obj.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const createdAt = obj.get('createdAt');
  const width = obj.get('width');
  const height = obj.get('height');
  const base: ObjectSnapshot = {
    id,
    type,
    x,
    y,
    width: isFiniteNumber(width) && width > 0 ? width : STICKY_SIZE_WORLD,
    height: isFiniteNumber(height) && height > 0 ? height : STICKY_SIZE_WORLD,
    z: zOf(obj),
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
  if (type !== 'sticky') {
    const read = READERS.get(type);
    return Object.freeze(read ? read(base, obj) : base);
  }
  const color = obj.get('color');
  const text = obj.get('text');
  return Object.freeze({
    ...base,
    type: 'sticky' as const,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
  });
}

function byZ(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Immutable list of every known-type object sorted by (z, id); unknown types are skipped. */
export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const list: ObjectSnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const s = toObject(id, obj);
    if (s) list.push(s);
  });
  list.sort(byZ);
  if (DERIVERS.size > 0 && list.some((o) => DERIVERS.has(o.type))) {
    const rects = storedRects(list);
    for (let i = 0; i < list.length; i++) {
      const derive = DERIVERS.get(list[i].type);
      if (derive) list[i] = Object.freeze(derive(list[i], rects));
    }
  }
  return Object.freeze(list);
}

/** Immutable list of sticky notes sorted by (z, id). */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return Object.freeze(objectsSnapshot(doc).filter(isSticky));
}
