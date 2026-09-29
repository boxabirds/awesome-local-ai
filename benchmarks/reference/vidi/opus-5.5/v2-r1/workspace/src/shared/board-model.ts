// Board document schema and every mutation of it. Framework-free: the Durable Object
// (story 4) imports this module for validation and migration.
//
// Y.Doc
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }>
//
// `width`/`height` (story 7) are optional: objects without them are STICKY_SIZE_WORLD square.
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { type Point, type Rect, isFiniteRect, rectContains } from './geometry';

/** Transaction origin of changes made by this client (used by undo and sync in later stories). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');
export const SCHEMA_VERSION = 1;

/** Fields every board object has, whatever its type. */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  /** Size in world units (STICKY_SIZE_WORLD when not stored). */
  readonly width: number;
  readonly height: number;
  /** Stacking order; higher is on top. */
  readonly z: number;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
}

/** Object types this model knows how to read. */
export const MODEL_TYPES: ReadonlySet<string> = new Set(['sticky']);

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects');
}

function getObject(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? (obj as ObjectMap) : undefined;
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((obj) => {
    if (obj instanceof Y.Map) max = Math.max(max, zOf(obj as ObjectMap));
  });
  return max;
}

export function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && Object.hasOwn(STICKY_COLORS, color);
}

/** Sets `meta.schemaVersion` if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), on top of every other object.
 * Returns the new id, or `false` for non-finite coordinates or an unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isStickyColor(color)) return false;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('width', STICKY_SIZE_WORLD);
    note.set('height', STICKY_SIZE_WORLD);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objectsOf(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

export function hasObject(doc: Y.Doc, id: string): boolean {
  return getObject(doc, id) !== undefined;
}

/** Moves an object's top-left to (x, y). False for a stale id, non-finite coordinates or no change. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** Raises an object above all others. False for a stale id or when it is already strictly on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Changes only the colour. False for a stale id, a non-sticky object, an unknown colour or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky' || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sizeOf(obj: ObjectMap, key: 'width' | 'height'): number {
  const v = obj.get(key);
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : STICKY_SIZE_WORLD;
}

function readObject(id: string, value: unknown): ObjectSnapshot | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const obj = value as ObjectMap;
  const type = obj.get('type');
  const x = obj.get('x');
  const y = obj.get('y');
  if (typeof type !== 'string' || typeof x !== 'number' || typeof y !== 'number') return undefined;
  const createdAt = obj.get('createdAt');
  const base = {
    id,
    type,
    x,
    y,
    width: sizeOf(obj, 'width'),
    height: sizeOf(obj, 'height'),
    z: zOf(obj),
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
  if (type !== 'sticky') return Object.freeze(base);
  const color = obj.get('color');
  const text = obj.get('text');
  return Object.freeze({
    ...base,
    type: 'sticky' as const,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
  });
}

function byStacking(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z - b.z || compareIds(a.id, b.id);
}

/**
 * Every object with a type and a position, sorted by (z, id), including types this client does
 * not know (the renderer and selection skip those). Malformed entries are skipped.
 */
export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    const obj = readObject(id, value);
    if (obj) objects.push(obj);
  });
  objects.sort(byStacking);
  return Object.freeze(objects);
}

/** Immutable sticky notes sorted by (z, id); unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return Object.freeze(
    objectsSnapshot(doc).filter((o): o is StickySnapshot => o.type === 'sticky'),
  );
}

export function isSticky(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

// ---- Story 7: geometry and group operations -------------------------------------------------

type TypeFilter = (type: string) => boolean;
const knownToModel: TypeFilter = (type) => MODEL_TYPES.has(type);

/** An object's rect in world units. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/** Ids of known-type objects lying entirely inside `rect` (marquee rule), in stacking order. */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
  isKnownType: TypeFilter = knownToModel,
): string[] {
  return objects
    .filter((o) => isKnownType(o.type) && rectContains(rect, objectBounds(o)))
    .map((o) => o.id);
}

/** Ids of every known-type object (select all), in stacking order. */
export function allObjectIds(
  objects: readonly ObjectSnapshot[],
  isKnownType: TypeFilter = knownToModel,
): string[] {
  return objects.filter((o) => isKnownType(o.type)).map((o) => o.id);
}

/**
 * Moves each object's top-left to its absolute position. Missing ids and unchanged objects are
 * skipped. Any non-finite value rejects the whole call. Returns the number of objects changed
 * (one transaction; none when 0).
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const changes: [ObjectMap, Point][] = [];
  for (const [id, p] of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
    const obj = getObject(doc, id);
    if (obj && (obj.get('x') !== p.x || obj.get('y') !== p.y)) changes.push([obj, p]);
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

/**
 * Sets each object's absolute rect (writing `width` and `height`, which makes an implicitly sized
 * sticky explicit). Non-finite values or a non-positive size reject the whole call. Missing ids
 * and unchanged objects are skipped. Returns the number changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const changes: [ObjectMap, Rect][] = [];
  for (const [id, r] of rects) {
    if (!isFiniteRect(r) || r.width <= 0 || r.height <= 0) return 0;
    const obj = getObject(doc, id);
    if (!obj) continue;
    const same =
      obj.get('x') === r.x &&
      obj.get('y') === r.y &&
      obj.get('width') === r.width &&
      obj.get('height') === r.height;
    if (!same) changes.push([obj, r]);
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

/**
 * Raises the objects above every other object, keeping their order among themselves
 * (z = highest other z + rank). Nothing is written when they already are all above the rest.
 * Returns the number of objects whose z changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: { id: string; obj: ObjectMap; z: number }[] = [];
  let othersMax = -Infinity;
  objectsOf(doc).forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const obj = value as ObjectMap;
    if (wanted.has(id)) selected.push({ id, obj, z: zOf(obj) });
    else othersMax = Math.max(othersMax, zOf(obj));
  });
  if (selected.length === 0) return 0;
  if (Math.min(...selected.map((s) => s.z)) > othersMax) return 0;
  selected.sort((a, b) => a.z - b.z || compareIds(a.id, b.id));
  const base = Number.isFinite(othersMax) ? othersMax : 0;
  let changed = 0;
  doc.transact(() => {
    selected.forEach((s, rank) => {
      const z = base + rank + 1;
      if (s.z !== z) {
        s.obj.set('z', z);
        changed++;
      }
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/** Deletes the objects; missing ids are skipped. Returns the number deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = [...new Set(ids)].filter((id) => getObject(doc, id) !== undefined);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
