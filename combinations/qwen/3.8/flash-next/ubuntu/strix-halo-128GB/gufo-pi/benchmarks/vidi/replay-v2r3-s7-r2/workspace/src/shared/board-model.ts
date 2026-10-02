/**
 * Board document model (story 2).
 *
 * Owns the Yjs schema and every mutation of board objects. Framework-free on
 * purpose: the Durable Object imports this module from story 4 for validation
 * and migration, and story 3 attaches a network provider to the same document.
 *
 * Schema
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map { type, x, y, z, createdAt, width?, height?, ... }
 *
 * Story 7 adds the generic half of the model: every board object shares one
 * position/size/stacking shape, so selection, moving, resizing and deleting are
 * written once here instead of once per object type. A type declares its size
 * rules to the client registry; the model only needs to know which type names
 * exist, so objects from a future version stay unread rather than breaking the
 * board.
 */
import * as Y from 'yjs';
import type { StickyColor } from './config';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { Point, Rect } from './geometry';
import { isFiniteNumber, isFinitePointValue, isFiniteRect, rectContains } from './geometry';

/** Transaction origin for local user edits (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';

/**
 * One board object of any type. `width`/`height` are optional: an object
 * created before story 7 has no stored size and renders at its type's default
 * (`objectBounds` falls back to STICKY_SIZE_WORLD); the first resize writes
 * both fields. Sticky-note specific fields are optional because a snapshot may
 * describe another type.
 */
export interface ObjectSnapshot {
  id: string;
  /** Registry key of the object's type, e.g. `'sticky'`. */
  type: string;
  /** Top-left in world units. */
  x: number;
  y: number;
  /** Stacking order; higher is drawn on top. */
  z: number;
  width?: number;
  height?: number;
  createdAt: number;
  color?: StickyColor;
  text?: string;
}

/** Story 2's name for a board object; kept so existing code reads naturally. */
export type StickySnapshot = ObjectSnapshot;

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

/**
 * Object types this build understands. Objects of any other type are skipped by
 * `snapshot`, `objectsInRect` and `allObjectIds`, which is what keeps a board
 * written by a newer client readable here. The client object registry adds its
 * own types here as it registers them.
 */
const KNOWN_OBJECT_TYPES = new Set<string>(['sticky']);

/** Declares `type` as an object type this build can read and select. */
export function registerKnownObjectType(type: string): void {
  if (typeof type === 'string' && type !== '') KNOWN_OBJECT_TYPES.add(type);
}

export function isKnownObjectType(type: unknown): boolean {
  return typeof type === 'string' && KNOWN_OBJECT_TYPES.has(type);
}

export function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

/** Sets `meta.schemaVersion` when absent. Never overwrites an existing version. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/** The stored size of an object, or undefined when it uses its type default. */
function readSize(m: Y.Map<unknown>, key: 'width' | 'height'): number | undefined {
  const value = m.get(key);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read the fields every board object shares. Returns null for an object whose
 * position or stacking order is unusable, so it stays off the board rather than
 * breaking the snapshot.
 */
function readObjectBase(id: string, m: Y.Map<unknown>): ObjectSnapshot | null {
  const type = m.get('type');
  if (!isKnownObjectType(type)) return null; // forward compatibility: skip unknown types
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  const createdAt = m.get('createdAt');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  if (typeof z !== 'number') return null;
  const obj: ObjectSnapshot = {
    id,
    type: type as string,
    x,
    y,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
  const width = readSize(m, 'width');
  const height = readSize(m, 'height');
  if (width !== undefined) obj.width = width;
  if (height !== undefined) obj.height = height;
  return obj;
}

function readSticky(id: string, m: Y.Map<unknown>): ObjectSnapshot | null {
  if (m.get('type') !== 'sticky') return null;
  const base = readObjectBase(id, m);
  if (!base) return null;
  const color = m.get('color');
  const text = m.get('text');
  base.color = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  base.text = text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '';
  return base;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Creates a sticky note centred on the world point `at`.
 * Returns the new id, or `''` when the point or colour is invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFinitePoint(at?.x, at?.y)) return '';
  if (!isStickyColor(color)) return '';

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', x);
    m.set('y', y);
    m.set('width', STICKY_SIZE_WORLD);
    m.set('height', STICKY_SIZE_WORLD);
    m.set('color', color);
    m.set('text', new Y.Text());
    m.set('z', z);
    m.set('createdAt', Date.now());
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'sticky') return undefined;
  return m;
}

/**
 * Moves a note to a new world top-left. Returns false when rejected or
 * unchanged. Story 2's single-object form of `moveObjects`.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map<string, Point>([[id, { x, y }]])) > 0;
}

/**
 * Raises a note above every other note. Returns false when already topmost.
 * Story 2's single-object form of `bringObjectsToFront`.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Applies one of the six preset colours. Returns false for unknown colours/stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isStickyColor(color)) return false;
  if (m.get('color') === color) return false;

  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Removes an object from the board. Returns false when the id is unknown.
 * Story 2's single-object form of `deleteObjects`.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

// ---------------------------------------------------------------------------
// Story 7: generic group operations
// ---------------------------------------------------------------------------

/**
 * The rect an object occupies. An object without a stored size renders at its
 * type's default, which is STICKY_SIZE_WORLD for the sticky notes created
 * before story 7.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: isFiniteNumber(obj.width) && obj.width! > 0 ? obj.width! : STICKY_SIZE_WORLD,
    height: isFiniteNumber(obj.height) && obj.height! > 0 ? obj.height! : STICKY_SIZE_WORLD,
  };
}

/** Ids of the snapshot objects lying *entirely* inside `rect` (marquee rule). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  if (!Array.isArray(snapshot) || !isFiniteRect(rect)) return [];
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (!obj || !isKnownObjectType(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/** Ids of every selectable object, skipping types this build does not know. */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  if (!Array.isArray(snapshot)) return [];
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (obj && isKnownObjectType(obj.type)) ids.push(obj.id);
  }
  return ids;
}

/**
 * Writes absolute world top-left positions. Absolute rather than incremental
 * writes are what makes two people dragging the same object converge on the
 * same place. Missing ids are skipped; one invalid position rejects the whole
 * call. Returns the number of objects changed, 0 with no transaction when
 * there is nothing to write.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (!(positions instanceof Map) || positions.size === 0) return 0;
  for (const [id, p] of positions) {
    if (typeof id !== 'string' || id === '') return 0;
    if (!isFinitePointValue(p)) return 0;
  }

  const objects = getObjectsMap(doc);
  const writes: Array<[Y.Map<unknown>, Point]> = [];
  for (const [id, p] of positions) {
    const m = objects.get(id);
    if (!m || !isKnownObjectType(m.get('type'))) continue;
    if (m.get('x') === p.x && m.get('y') === p.y) continue;
    writes.push([m, p]);
  }
  if (writes.length === 0) return 0;

  doc.transact(() => {
    for (const [m, p] of writes) {
      m.set('x', p.x);
      m.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Writes absolute rects. An object that had no stored size gains both fields,
 * so an implicit-size sticky becomes explicit on its first resize. Missing ids
 * are skipped; one invalid rect rejects the whole call.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (!(rects instanceof Map) || rects.size === 0) return 0;
  for (const [id, rect] of rects) {
    if (typeof id !== 'string' || id === '') return 0;
    if (!isFiniteRect(rect) || !(rect.width > 0) || !(rect.height > 0)) return 0;
  }

  const objects = getObjectsMap(doc);
  const writes: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, rect] of rects) {
    const m = objects.get(id);
    if (!m || !isKnownObjectType(m.get('type'))) continue;
    if (m.get('x') === rect.x && m.get('y') === rect.y && m.get('width') === rect.width && m.get('height') === rect.height) {
      continue;
    }
    writes.push([m, rect]);
  }
  if (writes.length === 0) return 0;

  doc.transact(() => {
    for (const [m, rect] of writes) {
      m.set('x', rect.x);
      m.set('y', rect.y);
      m.set('width', rect.width);
      m.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Raises the given objects above every object that is not in the list, keeping
 * the objects' relative stacking order among themselves. A selection that is
 * already in front of everything else is left alone, so dragging a top note
 * does not shuffle the stack. Returns the number of objects whose `z` actually
 * changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const objects = getObjectsMap(doc);

  const selected: Array<{ m: Y.Map<unknown>; z: number; id: string }> = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const m = objects.get(id);
    if (!m || !isKnownObjectType(m.get('type'))) continue;
    seen.add(id);
    const z = m.get('z');
    selected.push({ m, z: typeof z === 'number' ? z : 0, id });
  }
  if (selected.length === 0) return 0;

  let above = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (const [id, m] of objects.entries()) {
    if (seen.has(id)) continue;
    const z = m.get('z');
    if (typeof z === 'number' && z > above) above = z;
  }
  for (const entry of selected) if (entry.z < lowest) lowest = entry.z;
  // Every selected object is already higher than everything unselected.
  if (lowest > above) return 0;

  // Stable order: current z, then id, exactly as the board renders them.
  selected.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const writes: Array<[Y.Map<unknown>, number]> = [];
  selected.forEach((entry, i) => {
    const z = above + i + 1;
    if (entry.z === z) return;
    writes.push([entry.m, z]);
  });
  if (writes.length === 0) return 0;

  doc.transact(() => {
    for (const [m, z] of writes) m.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Removes every object in the list. Missing ids are skipped; one invalid id
 * rejects the whole call. Returns the number of objects removed.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const objects = getObjectsMap(doc);

  const present: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    if (!objects.has(id)) continue;
    seen.add(id);
    present.push(id);
  }
  if (present.length === 0) return 0;

  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** The `Y.Text` holding a note's text, for collaborative editing (story 3). */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getStickyMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable view of every known object, sorted by `(z, id)` so all clients
 * agree on the render order even when concurrent edits produce equal `z`.
 * Objects of unknown `type` are skipped.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjectsMap(doc);
  const notes: ObjectSnapshot[] = [];
  for (const [id, m] of objects.entries()) {
    const note = m.get('type') === 'sticky' ? readSticky(id, m) : readObjectBase(id, m);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
