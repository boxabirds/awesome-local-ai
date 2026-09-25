// Board document schema and every mutation on it. Framework-free: the client uses it now,
// the Durable Object will import it for validation and migration (story 4).
//
// Y.Doc
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }>
//   objects: Y.Map<id, Y.Map { type: 'text', x, y, width, height, z, createdAt, createdBy, text: Y.Text, size,
//                              widthMode }>   (story 9, src/shared/objects/text.ts)
//   objects: Y.Map<id, Y.Map { type: 'shape', ... kind, fill, stroke, label: Y.Text }>   (story 10, objects/shape.ts)
//   objects: Y.Map<id, Y.Map { type: 'connector', x: 0, y: 0, width: 0, height: 0, z, from, to }>
//                              (story 10, objects/connector.ts; the box is derived from the ends in objectSnapshot)
//   objects: Y.Map<id, Y.Map { type: 'stroke', ... points, color, thickness }>   (story 11, objects/stroke.ts)
//   objects: Y.Map<id, Y.Map { type: 'image', ... assetKey, status, uploaderId }>   (story 12, objects/image.ts)
//
// `width`/`height` were added in story 7. Notes saved before that have neither and are STICKY_SIZE_WORLD square;
// the first resize writes both. Every object type (stories 9-12) has at least type, x, y, width, height and z.
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejected or no-op calls
// return false before opening a transaction, so they emit no update.
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

export const SCHEMA_VERSION = 1;

/** Transaction origin for changes made by this client (story 3 skips echoes, story 8 undoes only these). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** What every board object has, whatever its type. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

// Object types this build knows how to show. Unknown types (from newer clients) are kept in the doc untouched but
// are not rendered, selected or changed by group operations. The client's object registry adds its types here.
const knownTypes = new Set<string>(['sticky']);

/** Marks `type` as a known object type (called by the client's object registry). */
export function registerModelObjectType(type: string): void {
  knownTypes.add(type);
}

/** Reads a type's own snapshot fields (story 9 text: content, size, width mode). Null skips a malformed object. */
export type SnapshotReader = (id: string, obj: Y.Map<unknown>, base: ObjectSnapshot) => ObjectSnapshot | null;
const snapshotReaders = new Map<string, SnapshotReader>();

/** Lets an object type's model module (src/shared/objects/*) add its fields to `objectSnapshot`. */
export function registerSnapshotReader(type: string, reader: SnapshotReader): void {
  snapshotReaders.set(type, reader);
}

/**
 * Runs once over the whole list after every object is read, before sorting. Lets a type derive fields from other
 * objects (story 10: a connector's ends and box follow the objects it is attached to). Returns the new list.
 */
export type SnapshotFinisher = (objects: readonly ObjectSnapshot[]) => ObjectSnapshot[];
const snapshotFinishers: SnapshotFinisher[] = [];

export function registerSnapshotFinisher(finish: SnapshotFinisher): void {
  snapshotFinishers.push(finish);
}

/**
 * How an object type is moved when its position is not simply its stored x and y (story 10: a connector's free
 * ends move, its attached ends stay with their objects). Given the object's current snapshot and the wanted
 * top-left, returns the writes to make (run inside the move's transaction) or null when nothing changes.
 */
export type PositionPlanner = (obj: Y.Map<unknown>, current: ObjectSnapshot, to: Point) => (() => void) | null;
const positionPlanners = new Map<string, PositionPlanner>();

export function registerPositionPlanner(type: string, plan: PositionPlanner): void {
  positionPlanners.set(type, plan);
}

/** Runs inside `deleteObjects`' transaction, before the objects are removed (story 10: connectors detach). */
export type DeleteHook = (doc: Y.Doc, ids: readonly string[]) => void;
const deleteHooks: DeleteHook[] = [];

export function registerDeleteHook(hook: DeleteHook): void {
  deleteHooks.push(hook);
}

export function isKnownObjectType(type: string): boolean {
  return knownTypes.has(type);
}

export function isSticky(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>('objects');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isStickyColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.hasOwn(STICKY_COLORS, c);
}

function getObject(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function zOf(obj: ObjectMap): number {
  const z = obj.get('z');
  return isFiniteNumber(z) ? z : 0;
}

/** Highest z among all objects (0 when there are none). New objects go at maxZ + 1. */
export function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((obj) => {
    if (obj instanceof Y.Map) max = Math.max(max, zOf(obj));
  });
  return max;
}

/** Sets `meta.schemaVersion` if absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Adds a sticky note centred on world point `at`, above all other objects.
 * Returns the new id, or '' (and changes nothing) when `at` is not finite.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('width', STICKY_SIZE_WORLD);
    obj.set('height', STICKY_SIZE_WORLD);
    obj.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objectsOf(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves an object's top-left to world (x, y). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Puts an object strictly above every other object. No-op (false) if it already is. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObject(doc, id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** A stored size, or STICKY_SIZE_WORLD when it is missing (notes from before story 7) or invalid. */
function sizeOf(v: unknown): number {
  return isFiniteNumber(v) && v > 0 ? v : STICKY_SIZE_WORLD;
}

function readObject(id: string, obj: ObjectMap): ObjectSnapshot | null {
  const type = obj.get('type');
  if (typeof type !== 'string' || !knownTypes.has(type)) return null;
  if (type === 'sticky') return readSticky(id, obj);
  const x = obj.get('x');
  const y = obj.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const base: ObjectSnapshot = { id, type, x, y, width: sizeOf(obj.get('width')), height: sizeOf(obj.get('height')), z: zOf(obj) };
  const reader = snapshotReaders.get(type);
  const out = reader ? reader(id, obj, base) : base;
  return out && Object.freeze(out);
}

function readSticky(id: string, obj: ObjectMap): StickySnapshot | null {
  if (obj.get('type') !== 'sticky') return null;
  const x = obj.get('x');
  const y = obj.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const color = obj.get('color');
  const text = obj.get('text');
  const createdAt = obj.get('createdAt');
  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    width: sizeOf(obj.get('width')),
    height: sizeOf(obj.get('height')),
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: zOf(obj),
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  });
}

/** Render order: by z, then by id so every client agrees when z values tie. */
export function compareStacking(a: { z: number; id: string }, b: { z: number; id: string }): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Immutable list of sticky notes sorted by (z, id). Unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const s = readSticky(id, obj);
    if (s) out.push(s);
  });
  out.sort(compareStacking);
  return Object.freeze(out);
}

/** Immutable list of every object of a known type, sorted by (z, id). Malformed objects are skipped. */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const s = readObject(id, obj);
    if (s) out.push(s);
  });
  let list: ObjectSnapshot[] = out;
  for (const finish of snapshotFinishers) list = finish(list);
  list.sort(compareStacking);
  return Object.freeze(list);
}

// Story 7 — group operations. Each mutating call rejects non-finite values and empty id lists with 0 and no
// transaction, skips ids that no longer exist (deleted by someone else), and otherwise makes all its changes in
// one LOCAL_ORIGIN transaction, returning how many objects changed.

/** An object's world rectangle. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  // A snapshot's size is already resolved; zero is a real size (a horizontal or vertical connector).
  const size = (v: number) => (isFiniteNumber(v) && v >= 0 ? v : STICKY_SIZE_WORLD);
  return { x: obj.x, y: obj.y, width: size(obj.width), height: size(obj.height) };
}

/** Ids of known objects lying entirely inside `rect` (partly inside does not count), in stacking order. */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  return objects.filter((o) => knownTypes.has(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every object of a known type, in stacking order. */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.filter((o) => knownTypes.has(o.type)).map((o) => o.id);
}

function knownObject(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = getObject(doc, id);
  const type = obj?.get('type');
  return obj && typeof type === 'string' && knownTypes.has(type) ? obj : undefined;
}

/**
 * Writes for the objects whose type has a position planner, planned against the board as it is now (before any
 * write). `rest` receives the ids of every other object.
 */
function planPositions(doc: Y.Doc, targets: ReadonlyMap<string, Point>, rest: Set<string>): Array<() => void> {
  const planned: Array<() => void> = [];
  let current: Map<string, ObjectSnapshot> | null = null;
  for (const [id, p] of targets) {
    const obj = knownObject(doc, id);
    if (!obj) continue;
    const plan = positionPlanners.get(obj.get('type') as string);
    if (!plan) {
      rest.add(id);
      continue;
    }
    current ??= new Map(objectSnapshot(doc).map((o) => [o.id, o]));
    const snap = current.get(id);
    const write = snap ? plan(obj, snap, p) : null;
    if (write) planned.push(write);
  }
  return planned;
}

/** Moves each object's top-left to its absolute world position. */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
  const plain = new Set<string>();
  const planned = planPositions(doc, positions, plain);
  const changes: Array<[ObjectMap, Point]> = [];
  for (const [id, p] of positions) {
    if (!plain.has(id)) continue;
    const obj = knownObject(doc, id);
    if (obj && (obj.get('x') !== p.x || obj.get('y') !== p.y)) changes.push([obj, p]);
  }
  if (changes.length === 0 && planned.length === 0) return 0;
  doc.transact(() => {
    planned.forEach((write) => write());
    for (const [obj, p] of changes) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return changes.length + planned.length;
}

/** Sets each object's position and size (writing width and height even for notes that had neither). */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) if (![r.x, r.y, r.width, r.height].every(isFiniteNumber)) return 0;
  // Types with a position planner (connectors) have no size of their own: they only move, and their size may be 0.
  const plain = new Set<string>();
  for (const [id, r] of rects) {
    const type = knownObject(doc, id)?.get('type');
    if (!positionPlanners.has(type as string) && (r.width <= 0 || r.height <= 0)) return 0;
  }
  const planned = planPositions(doc, rects, plain);
  const changes: Array<[ObjectMap, Rect]> = [];
  for (const [id, r] of rects) {
    if (!plain.has(id)) continue;
    const obj = knownObject(doc, id);
    if (!obj) continue;
    const same = obj.get('x') === r.x && obj.get('y') === r.y && obj.get('width') === r.width && obj.get('height') === r.height;
    if (!same) changes.push([obj, r]);
  }
  if (changes.length === 0 && planned.length === 0) return 0;
  doc.transact(() => {
    planned.forEach((write) => write());
    for (const [obj, r] of changes) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changes.length + planned.length;
}

/**
 * Lifts the objects above every other object, keeping their order among themselves
 * (z = highest other z + rank). No-op (0) when they already are strictly above all others.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: Array<{ id: string; z: number; obj: ObjectMap }> = [];
  let othersMax = 0;
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    if (wanted.has(id)) selected.push({ id, z: zOf(obj), obj });
    else othersMax = Math.max(othersMax, zOf(obj));
  });
  if (selected.length === 0) return 0;
  if (selected.every((s) => s.z > othersMax)) return 0;
  selected.sort(compareStacking);
  doc.transact(() => selected.forEach((s, i) => s.obj.set('z', othersMax + i + 1)), LOCAL_ORIGIN);
  return selected.length;
}

/** Removes the objects. Connectors attached to them keep their ends where they were (story 10 delete hook). */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const present = [...new Set(ids)].filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    deleteHooks.forEach((hook) => hook(doc, present));
    present.forEach((id) => objects.delete(id));
  }, LOCAL_ORIGIN);
  return present.length;
}
