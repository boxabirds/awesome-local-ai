/**
 * Board document schema and every mutation on it (anchor: board.model).
 *
 * Framework-free: the client uses it now; the Durable Object imports it from story 4
 * for validation and migration.
 *
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }>
 *
 * Story 7: `width`/`height` are optional; objects without them are STICKY_SIZE_WORLD square
 * (notes created before resizing existed). The first resize writes both. Group operations
 * (`moveObjects`, `resizeObjects`, `bringObjectsToFront`, `deleteObjects`) work on any
 * object type; the story 2 single-object functions are thin wrappers over them.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejections
 * (stale id, unknown colour, non-finite numbers, no-op) return `false` before opening a
 * transaction, so no Yjs update is emitted. Nothing here throws for user-driven input.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

/** Transaction origin for changes made by this client (used by undo and sync later). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export const SCHEMA_VERSION = 1;
const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = 'sticky';
const HALF = 2;
/** z of the first object on an empty board is FIRST_Z (= 0 + 1). */
const EMPTY_BOARD_MAX_Z = 0;

/** Any board object, whatever its type (anchor: sel.geometry_ops). */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export function isStickySnapshot(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === STICKY_TYPE;
}

/**
 * Object types the client can show and select. `sticky` is built in; the client's object
 * registry declares the others (sel.registry). Select all and the marquee skip the rest.
 */
const knownTypes = new Set<string>([STICKY_TYPE]);

export function declareObjectType(type: string): void {
  knownTypes.add(type);
}

export function isKnownObjectType(type: string): boolean {
  return knownTypes.has(type);
}

/** Reads the type-specific fields of an object on top of the generic ones (story 9 text). */
export type SnapshotReader = (base: ObjectSnapshot, obj: Y.Map<unknown>) => ObjectSnapshot;
const snapshotReaders = new Map<string, SnapshotReader>();

/** Declares `type` known and lets `reader` add its fields to snapshots of that type. */
export function registerSnapshotReader(type: string, reader: SnapshotReader): void {
  declareObjectType(type);
  snapshotReaders.set(type, reader);
}

/**
 * Story 10: objects whose geometry derives from other objects (connectors). After every
 * object is read, `resolve` gets the snapshot and the rects of all objects of types
 * without a resolver, and returns the snapshot with its derived fields.
 */
export type SnapshotResolver = (snap: ObjectSnapshot, rects: ReadonlyMap<string, Rect>) => ObjectSnapshot;
const snapshotResolvers = new Map<string, SnapshotResolver>();

export function registerSnapshotResolver(type: string, resolve: SnapshotResolver): void {
  snapshotResolvers.set(type, resolve);
}

/**
 * Story 10: runs inside `deleteObjects`' transaction before the objects are removed (the
 * connector model detaches arrows from them). Kept as a hook so board-model imports no
 * object type module.
 */
export type DeleteHook = (doc: Y.Doc, deletedIds: readonly string[]) => void;
const deleteHooks: DeleteHook[] = [];

export function registerDeleteHook(hook: DeleteHook): void {
  if (!deleteHooks.includes(hook)) deleteHooks.push(hook);
}

type ObjectMap = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

export function isStickyColor(value: string): value is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function finite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : EMPTY_BOARD_MAX_Z;
}

function maxZ(doc: Y.Doc): number {
  let max = EMPTY_BOARD_MAX_Z;
  objects(doc).forEach((obj) => {
    max = Math.max(max, zOf(obj));
  });
  return max;
}

/** z that puts a new object above every existing one. */
export function nextZ(doc: Y.Doc): number {
  return maxZ(doc) + 1;
}

/** Sets meta.schemaVersion when absent. Emits no update when already initialised. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), above every other object.
 * Returns the new id, or '' (and changes nothing) for non-finite coordinates.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!finite(at.x, at.y) || !isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    note.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    note.set('width', STICKY_SIZE_WORLD);
    note.set('height', STICKY_SIZE_WORLD);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves an object's top-left to (x, y) in world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Puts an object strictly above all others. No update when it already is. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objects(doc).get(id);
  if (obj === undefined || obj.get('type') !== STICKY_TYPE || !isStickyColor(color)) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

// ---- Story 7: group operations (anchor: sel.geometry_ops) ----

function positiveSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : STICKY_SIZE_WORLD;
}

/** The object's rect in world units. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/** Ids of known-type objects lying entirely inside `rect` (the marquee rule). */
export function objectsInRect(objs: readonly ObjectSnapshot[], rect: Rect): string[] {
  return objs.filter((o) => isKnownObjectType(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every known-type object (select all). */
export function allObjectIds(objs: readonly ObjectSnapshot[]): string[] {
  return objs.filter((o) => isKnownObjectType(o.type)).map((o) => o.id);
}

/**
 * Moves each object's top-left to its absolute position. Any non-finite value rejects the
 * whole call (0, no transaction); missing ids and unchanged positions are skipped.
 * Returns the number of objects moved (one transaction).
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!finite(p.x, p.y)) return 0;
  const map = objects(doc);
  const changes: [ObjectMap, Point][] = [];
  positions.forEach((p, id) => {
    const obj = map.get(id);
    if (obj === undefined || (obj.get('x') === p.x && obj.get('y') === p.y)) return;
    changes.push([obj, p]);
  });
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
 * Sets each object's rect (position and size; always writes width and height, which turns
 * an implicit-size note explicit). Non-finite values or sizes <= 0 reject the whole call.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) {
    if (!finite(r.x, r.y, r.width, r.height) || r.width <= 0 || r.height <= 0) return 0;
  }
  const map = objects(doc);
  const changes: [ObjectMap, Rect][] = [];
  rects.forEach((r, id) => {
    const obj = map.get(id);
    if (obj === undefined) return;
    const same =
      obj.get('x') === r.x && obj.get('y') === r.y && obj.get('width') === r.width && obj.get('height') === r.height;
    if (!same) changes.push([obj, r]);
  });
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
 * Raises the given objects above every other object, keeping their order among themselves
 * (z = max unselected z + rank). No update when they already are all on top.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const wanted = new Set(ids);
  const selected: { id: string; obj: ObjectMap; z: number }[] = [];
  let othersMax = Number.NEGATIVE_INFINITY;
  map.forEach((obj, id) => {
    if (wanted.has(id)) selected.push({ id, obj, z: zOf(obj) });
    else othersMax = Math.max(othersMax, zOf(obj));
  });
  if (selected.length === 0) return 0;
  if (selected.every((s) => s.z > othersMax)) return 0;
  const base = othersMax === Number.NEGATIVE_INFINITY ? EMPTY_BOARD_MAX_Z : othersMax;
  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const changes = selected.map((s, i) => ({ ...s, next: base + i + 1 })).filter((s) => s.next !== s.z);
  doc.transact(() => {
    for (const c of changes) c.obj.set('z', c.next);
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Removes the given objects; missing ids are skipped. Returns how many were removed. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const present = [...new Set(ids)].filter((id) => map.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const hook of deleteHooks) hook(doc, present);
    for (const id of present) map.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** The stored rect of an object (world units), or undefined for a missing or unreadable one. */
export function objectRect(doc: Y.Doc, id: string): Rect | undefined {
  const obj = objects(doc).get(id);
  if (!(obj instanceof Y.Map)) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  if (typeof x !== 'number' || typeof y !== 'number' || !finite(x, y)) return undefined;
  return { x, y, width: positiveSize(obj.get('width')), height: positiveSize(obj.get('height')) };
}

/** Type of an object, or undefined when it does not exist. */
export function objectType(doc: Y.Doc, id: string): string | undefined {
  const type = objects(doc).get(id)?.get('type');
  return typeof type === 'string' ? type : undefined;
}

/** True while an object with this id exists in the document. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objects(doc).has(id);
}

/** Calls `onChange` after every change to any object (deep); returns an unsubscribe. */
export function observeObjects(doc: Y.Doc, onChange: () => void): () => void {
  const map = objects(doc);
  const handler = () => onChange();
  map.observeDeep(handler);
  return () => map.unobserveDeep(handler);
}

/** True when `ytext` can no longer be edited (its note was deleted). */
export function isDetachedText(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = objects(doc).get(id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function compareZ(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function readObject(id: string, obj: ObjectMap): ObjectSnapshot | StickySnapshot | null {
  const type = obj.get('type');
  const x = obj.get('x');
  const y = obj.get('y');
  if (typeof type !== 'string' || typeof x !== 'number' || typeof y !== 'number' || !finite(x, y)) return null;
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const base: ObjectSnapshot = {
    id,
    type,
    x,
    y,
    width: positiveSize(obj.get('width')),
    height: positiveSize(obj.get('height')),
    z: typeof z === 'number' && Number.isFinite(z) ? z : EMPTY_BOARD_MAX_Z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
  if (type !== STICKY_TYPE) {
    const reader = snapshotReaders.get(type);
    return Object.freeze(reader === undefined ? base : reader(base, obj));
  }
  const color = obj.get('color');
  const text = obj.get('text');
  return Object.freeze({
    ...base,
    type: STICKY_TYPE,
    color: typeof color === 'string' && isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
  });
}

/** Immutable list of every readable object of any type, sorted by (z, id). */
export function snapshotObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const list: ObjectSnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const read = readObject(id, obj);
    if (read !== null) list.push(read);
  });
  if (snapshotResolvers.size > 0 && list.some((o) => snapshotResolvers.has(o.type))) {
    const rects = new Map<string, Rect>();
    for (const o of list) if (!snapshotResolvers.has(o.type)) rects.set(o.id, objectBounds(o));
    for (let i = 0; i < list.length; i += 1) {
      const resolve = snapshotResolvers.get(list[i]!.type);
      if (resolve !== undefined) list[i] = Object.freeze(resolve(list[i]!, rects));
    }
  }
  list.sort(compareZ);
  return Object.freeze(list);
}

/** Immutable list of sticky notes sorted by (z, id); other object types are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return Object.freeze(snapshotObjects(doc).filter(isStickySnapshot));
}
