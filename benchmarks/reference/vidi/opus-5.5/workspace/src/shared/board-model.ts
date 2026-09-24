/**
 * The board document: Yjs schema and every mutation on it.
 *
 * Framework-free so the Durable Object (story 4) can import it for validation and migration.
 * This schema is the future persisted format (story 4) and wire format (story 3):
 *
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map { type: 'sticky', x, y, width?, height?, color, text: Y.Text, z, createdAt }>
 *
 * Story 7: every object type shares x, y, width, height, z and createdAt. `width`/`height` are
 * additive: stickies saved before story 7 have neither and are STICKY_SIZE_WORLD square; the
 * first resize writes both. Group operations (move, resize, stack, delete) are type-agnostic.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`. Rejected calls
 * (stale id, unknown colour, non-finite numbers, no-ops) return false before opening a
 * transaction, so they emit no update. Nothing here throws for user-driven input.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

/** Transaction origin for changes made by this client (story 3 uses it to avoid echo, story 8 for undo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export const SCHEMA_VERSION = 1;
const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = 'sticky';
const HALF = 2;
/** z of the first object on an empty board is FIRST_Z. */
const FIRST_Z = 1;

/** Object types this module knows how to read and create (the client registry may add more). */
export const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set([STICKY_TYPE]);

/** Any object on the board. `width`/`height` are present only once written (see objectBounds). */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  createdAt: number;
  /** Sticky notes only. */
  color?: StickyColor;
  /** Sticky notes only. */
  text?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export function isSticky(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === STICKY_TYPE;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

function objectOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map ? (value as ObjectMap) : undefined;
}

function isStickyColor(color: string): color is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Highest z among all objects, or FIRST_Z - 1 when the board is empty. */
function maxZ(doc: Y.Doc): number {
  let max = FIRST_Z - 1;
  objectsOf(doc).forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumber(value.get('z'));
    if (z !== undefined && z > max) max = z;
  });
  return max;
}

/** Sets meta.schemaVersion when absent (a no-op on an already initialised doc). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
}

/**
 * Creates a sticky centred on world point `at`, on top of every other object.
 * Returns the new id, or '' (no transaction) when `at` is not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const safeColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    objectsOf(doc).set(id, note);
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    note.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    note.set('width', STICKY_SIZE_WORLD);
    note.set('height', STICKY_SIZE_WORLD);
    note.set('color', safeColor);
    note.set('text', new Y.Text());
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

/** True when an object with this id is on the board. */
export function hasObject(doc: Y.Doc, id: string): boolean {
  return objectOf(doc, id) !== undefined;
}

/** Moves an object's top-left to world (x, y). False for stale ids, non-finite values and no-ops. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Puts an object above all others. False (no update) when it is already alone on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Changes a sticky's colour. False for stale ids, unknown colours and the current colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== STICKY_TYPE || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The shared text of a sticky, or undefined for stale ids and non-sticky objects. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectOf(doc, id);
  if (!obj || obj.get('type') !== STICKY_TYPE) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const n = finiteNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** Fields every object type shares; undefined for malformed entries. */
function readBase(id: string, value: unknown): ObjectSnapshot | undefined {
  if (!(value instanceof Y.Map)) return undefined;
  const type = value.get('type');
  const x = finiteNumber(value.get('x'));
  const y = finiteNumber(value.get('y'));
  if (typeof type !== 'string' || x === undefined || y === undefined) return undefined;
  const base: ObjectSnapshot = {
    id,
    type,
    x,
    y,
    z: finiteNumber(value.get('z')) ?? FIRST_Z - 1,
    createdAt: finiteNumber(value.get('createdAt')) ?? 0,
  };
  const width = positiveNumber(value.get('width'));
  const height = positiveNumber(value.get('height'));
  if (width !== undefined) base.width = width;
  if (height !== undefined) base.height = height;
  return base;
}

function readObject(id: string, value: unknown): ObjectSnapshot | undefined {
  const base = readBase(id, value);
  if (!base || base.type !== STICKY_TYPE || !(value instanceof Y.Map)) return base;
  const rawColor = value.get('color');
  const text = value.get('text');
  const sticky: StickySnapshot = {
    ...base,
    type: STICKY_TYPE,
    color: typeof rawColor === 'string' && isStickyColor(rawColor) ? rawColor : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
  };
  return sticky;
}

function byStack(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Immutable view of the board sorted by (z, id); unknown or malformed objects are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objectSnapshot(doc).filter(isSticky);
}

/**
 * Every well-formed object of any type (x, y finite; type a string), sorted by (z, id).
 * Types the client does not know are included here; the renderer and selection skip them.
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const all: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    const obj = readObject(id, value);
    if (obj) all.push(obj);
  });
  all.sort(byStack);
  return all;
}

// ---- Story 7: geometry of objects and generic group operations ----

/** World rect of an object; objects without stored width/height are STICKY_SIZE_WORLD square. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width ?? STICKY_SIZE_WORLD, height: obj.height ?? STICKY_SIZE_WORLD };
}

function knownByDefault(type: string): boolean {
  return KNOWN_OBJECT_TYPES.has(type);
}

/**
 * Ids of the known objects lying entirely inside `rect` (marquee rule: partly inside is not
 * selected), bottom to top. `isKnownType` defaults to the types this module creates.
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
  isKnownType: (type: string) => boolean = knownByDefault,
): string[] {
  return objects.filter((o) => isKnownType(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every known object (select all); unknown types are never selectable. */
export function allObjectIds(
  objects: readonly ObjectSnapshot[],
  isKnownType: (type: string) => boolean = knownByDefault,
): string[] {
  return objects.filter((o) => isKnownType(o.type)).map((o) => o.id);
}

/**
 * Moves each object's top-left to its absolute world position. Missing ids and same-position
 * entries are skipped; any non-finite value rejects the whole call. Returns the number of
 * objects moved; 0 means no transaction was opened.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  const changes: [ObjectMap, Point][] = [];
  for (const [id, p] of positions) {
    const obj = objectOf(doc, id);
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

function sameRect(obj: ObjectMap, r: Rect): boolean {
  return obj.get('x') === r.x && obj.get('y') === r.y && obj.get('width') === r.width && obj.get('height') === r.height;
}

/**
 * Sets each object's position and size (writing width and height, which makes implicit-size
 * stickies explicit). Missing ids and unchanged rects are skipped; any non-finite value or
 * non-positive size rejects the whole call. Returns the number of objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) {
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return 0;
  }
  const changes: [ObjectMap, Rect][] = [];
  for (const [id, r] of rects) {
    const obj = objectOf(doc, id);
    if (!obj || sameRect(obj, r)) continue;
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

/**
 * Raises the given objects above every other object, keeping their order among themselves:
 * z = (highest z of the others) + rank. Nothing changes when they are already strictly above
 * all others. Returns the number of objects whose z changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: { id: string; obj: ObjectMap; z: number }[] = [];
  let topOther = FIRST_Z - 1;
  objectsOf(doc).forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const z = finiteNumber(value.get('z'));
    if (wanted.has(id)) selected.push({ id, obj: value as ObjectMap, z: z ?? FIRST_Z - 1 });
    else if (z !== undefined && z > topOther) topOther = z;
  });
  if (selected.length === 0) return 0;
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Already strictly above every other object: nothing to do (and nothing to sync).
  if (selected[0]!.z > topOther) return 0;
  const changes = selected
    .map((s, i) => ({ obj: s.obj, from: s.z, to: topOther + i + 1 }))
    .filter((c) => c.from !== c.to);
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const c of changes) c.obj.set('z', c.to);
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Removes the given objects in one transaction; missing ids are skipped. Returns the count. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = [...new Set(ids)].filter((id) => objectsOf(doc).has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
