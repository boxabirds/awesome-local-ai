/**
 * The board document model: the Yjs schema plus every mutation the app can
 * perform on board objects.
 *
 * This module is deliberately framework-free (no React, no DOM) so that the
 * Durable Object from story 4 can import it for validation and migration, and
 * so that story 3 can attach a network provider to the very same document.
 *
 * Schema (this is the future persisted and wire format, hence `meta`):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking order, higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * every rejection (stale id, unknown colour, non-finite number, pointless
 * no-op) returns `false` **before** a transaction is opened, so it produces no
 * update and therefore no sync traffic. The module never throws for
 * user-driven input.
 */

import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  isStickyColor,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config.js';
import type { Point, Rect } from './geometry.js';
import { rectContains } from './geometry.js';

export type { Point, Rect } from './geometry.js';

/** Origin of every local transaction (story 8 undo, story 3 echo avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Name of the document metadata map. */
export const DOC_META_MAP = 'meta';
/** Name of the object map. */
export const DOC_OBJECTS_MAP = 'objects';
/** Schema version written into `meta` (story 4 migrates from this number). */
export const SCHEMA_VERSION = 1;
/** The only object type this story knows; stories 9-12 add others. */
export const STICKY_TYPE = 'sticky';

/**
 * The object types board-model knows how to read, move, resize and restack.
 *
 * This is deliberately a *board-model* set rather than the client's render
 * registry: board-model is framework-free (the room imports it), so it cannot
 * import `src/client/objects/registry.tsx`. When the client registry registers a
 * type it calls {@link registerBoardObjectType} so the two agree on which types
 * are real, and a group operation refuses an object of a type board-model has
 * never heard of (a `bringToFront` of an unknown object is still `false`).
 */
const boardObjectTypes = new Set<string>([STICKY_TYPE]);

/**
 * Tell board-model about an object type the client registry has registered,
 * so group operations (move, resize, stack, delete) will act on it. Story 7 only
 * registers `sticky`; stories 9-12 add their types through the same path.
 */
export function registerBoardObjectType(type: string): void {
  if (typeof type === 'string' && type.length > 0) boardObjectTypes.add(type);
}

/** Whether board-model recognises `type` as a movable, resizable object. */
export function isKnownObjectType(type: unknown): type is string {
  return typeof type === 'string' && boardObjectTypes.has(type);
}

/** Field names inside one object map. */
export const OBJECT_FIELDS = {
  type: 'type',
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  color: 'color',
  text: 'text',
  z: 'z',
  createdAt: 'createdAt',
} as const;

/**
 * The common shape of every object on the board. An object's *size* is the
 * optional `width`/`height`: a sticky note created before story 7 has neither
 * field and is drawn at `STICKY_SIZE_WORLD` ({@link objectBounds} supplies the
 * fallback); the first resize writes both. `StickySnapshot` narrows this with
 * the fields only notes carry.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  /** Explicit world width; absent means the type's default size. */
  width?: number;
  /** Explicit world height; absent means the type's default size. */
  height?: number;
}

/** An immutable view of one sticky note, as rendered by the client. */
export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
}

/** A point in world units. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** Objects map, typed as the map-of-maps it is. */
type ObjectsMap = Y.Map<Y.Map<unknown>>;

const objectsOf = (doc: Y.Doc): ObjectsMap =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP) as unknown as ObjectsMap;

const metaOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(DOC_META_MAP);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const readStickyMap = (objects: ObjectsMap, id: string): Y.Map<unknown> | undefined => {
  const map = objects.get(id);
  if (!(map instanceof Y.Map)) return undefined;
  if (map.get(OBJECT_FIELDS.type) !== STICKY_TYPE) return undefined;
  return map;
};

/**
 * Any object map that board-model knows how to move, resize or restack: it must
 * exist, be a `Y.Map`, and carry one of {@link boardObjectTypes}. A `Y.Map` of
 * an unknown type is skipped, exactly as story 2's single-object functions did,
 * so `bringToFront`/`bringObjectsToFront` still refuse an object they do not
 * understand and write nothing.
 */
const readObjectMap = (objects: ObjectsMap, id: string): Y.Map<unknown> | undefined => {
  const map = objects.get(id);
  if (!(map instanceof Y.Map)) return undefined;
  if (!isKnownObjectType(map.get(OBJECT_FIELDS.type))) return undefined;
  return map;
};

/**
 * The default size of an object that carries no explicit width or height. Only
 * sticky notes exist so far and they default to a square
 * {@link STICKY_SIZE_WORLD}; stories 9-12 widen this to per-type defaults.
 */
const defaultObjectSize = (): number => STICKY_SIZE_WORLD;

/** Highest z in the document (0 when there are no objects). */
function maxZ(objects: ObjectsMap): number {
  let max = 0;
  objects.forEach((map) => {
    if (!(map instanceof Y.Map)) return;
    const z = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/** A unique object id. `crypto.randomUUID` is available in browser and worker. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Environment without the Web Crypto helper: still unique, just not a UUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Prepare a document for use. Idempotent: it never rewrites the schema version
 * of a document that already has one, so reopening a stored document (story 4)
 * does not produce an update.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaOf(doc);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (its stored position is the top-left,
 * `at - STICKY_SIZE_WORLD / 2`), on top of every other object (z = maxZ + 1).
 *
 * Returns the new id, or `false` when the point is not finite or the colour is
 * not one of the six.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  if (!isStickyColor(color)) return false;

  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const id = newId();

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, STICKY_TYPE);
    map.set(OBJECT_FIELDS.x, at.x - STICKY_SIZE_WORLD / 2);
    map.set(OBJECT_FIELDS.y, at.y - STICKY_SIZE_WORLD / 2);
    // A note made from story 7 on carries its size explicitly; one made before
    // it has no such field and is drawn at STICKY_SIZE_WORLD by objectBounds.
    map.set(OBJECT_FIELDS.width, STICKY_SIZE_WORLD);
    map.set(OBJECT_FIELDS.height, STICKY_SIZE_WORLD);
    map.set(OBJECT_FIELDS.color, color);
    map.set(OBJECT_FIELDS.text, new Y.Text());
    map.set(OBJECT_FIELDS.z, z);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move an object to a new top-left, in world units. `false` for a stale id or
 * a non-finite coordinate; a move to the position it already has is a no-op.
 * A thin wrapper over {@link moveObjects} (story 2 kept this signature).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map<string, Point>([[id, { x, y }]])) > 0;
}

/**
 * Move several objects at once to absolute top-left positions, in world units
 * (`sel.group_move`, and the arrow-key nudge reuses it with a step offset).
 *
 * The rule set is the one the transform gesture relies on:
 * - if *any* requested position is non-finite the whole call is rejected (0,
 *   no transaction) — a half-applied group move would scatter the selection;
 * - an id that is absent or of an unknown type is skipped, the rest still move;
 * - an object already at its target position is not rewritten;
 * - otherwise everything that changes goes in exactly one `LOCAL_ORIGIN`
 *   transaction, so a remote peer sees one update, and the number of objects
 *   actually changed is returned.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  // Reject the entire call on any non-finite coordinate, before a transaction.
  for (const point of positions.values()) {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return 0;
  }
  const objects = objectsOf(doc);
  const writes: { map: Y.Map<unknown>; x: number; y: number }[] = [];
  positions.forEach((point, id) => {
    const map = readObjectMap(objects, id);
    if (!map) return; // missing or unknown type: skipped
    if (map.get(OBJECT_FIELDS.x) === point.x && map.get(OBJECT_FIELDS.y) === point.y) return;
    writes.push({ map, x: point.x, y: point.y });
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const w of writes) {
      w.map.set(OBJECT_FIELDS.x, w.x);
      w.map.set(OBJECT_FIELDS.y, w.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Resize (and reposition) several objects at once to absolute rectangles
 * (`sel.resize`). The first resize of a note created before story 7 writes both
 * `width` and `height`, turning its implicit size explicit (Key decision 5).
 *
 * As with {@link moveObjects}: a non-finite coordinate, or a non-positive width
 * or height, rejects the whole call with 0 and no transaction; missing/unknown
 * ids are skipped; the rest go in one transaction; the count changed is returned.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const rect of rects.values()) {
    if (
      !rect ||
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return 0;
    }
  }
  const objects = objectsOf(doc);
  const writes: { map: Y.Map<unknown>; rect: Rect }[] = [];
  rects.forEach((rect, id) => {
    const map = readObjectMap(objects, id);
    if (!map) return;
    if (
      map.get(OBJECT_FIELDS.x) === rect.x &&
      map.get(OBJECT_FIELDS.y) === rect.y &&
      map.get(OBJECT_FIELDS.width) === rect.width &&
      map.get(OBJECT_FIELDS.height) === rect.height
    ) {
      return;
    }
    writes.push({ map, rect });
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const w of writes) {
      w.map.set(OBJECT_FIELDS.x, w.rect.x);
      w.map.set(OBJECT_FIELDS.y, w.rect.y);
      w.map.set(OBJECT_FIELDS.width, w.rect.width);
      w.map.set(OBJECT_FIELDS.height, w.rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Remove an object. `false` when the id does not exist (nothing to delete).
 * A thin wrapper over {@link deleteObjects}.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/**
 * Remove several objects at once (`sel.group_delete`). Missing ids are skipped;
 * an empty list does nothing; everything removed goes in one transaction; the
 * count removed is returned. An object is removed whatever its type, as story 2's
 * `deleteObject` always did - a delete is never rejected for not understanding
 * the thing being deleted.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const present = ids.filter((id) => objects.get(id) instanceof Y.Map);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Stack an object above every other one. Returns `false` when the object is
 * unknown or is already topmost, so a drag that grabs the top note costs no
 * sync traffic (story 3) and story 8's undo has nothing to undo.
 * A thin wrapper over {@link bringObjectsToFront}.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Raise a set of objects above every object that is *not* in the set
 * (`sel.group_move`'s stacking), keeping the selected objects' own relative
 * stacking order. Each selected object is given `z = maxUnselectedZ + rank`,
 * where `rank` is its position (1-based) in the selected objects ordered by their
 * current `(z, id)`. Unknown/missing ids are skipped; objects already above the
 * unselected ones keep their place and are not rewritten; the whole restack is
 * one transaction and the count changed is returned.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const selected = new Set<string>();
  for (const id of ids) {
    if (readObjectMap(objects, id)) selected.add(id);
  }
  if (selected.size === 0) return 0;

  // The highest z among objects the selection does *not* include. Every object
  // counts toward this ceiling, even one whose z is not finite, so the selection
  // is placed above the whole stack.
  let ceiling = 0;
  objects.forEach((map, id) => {
    if (!(map instanceof Y.Map) || selected.has(id)) return;
    const z = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(z) && z > ceiling) ceiling = z;
  });

  // Order the selected objects by their current stacking, then by id, so their
  // relative order survives the restack.
  const ordered: { id: string; map: Y.Map<unknown>; z: number }[] = [];
  selected.forEach((id) => {
    const map = objects.get(id)!;
    const z = map.get(OBJECT_FIELDS.z);
    ordered.push({ id, map, z: isFiniteNumber(z) ? z : 0 });
  });
  ordered.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));

  const writes: { map: Y.Map<unknown>; z: number }[] = [];
  ordered.forEach((entry, index) => {
    const target = ceiling + index + 1;
    if (entry.map.get(OBJECT_FIELDS.z) === target) return;
    writes.push({ map: entry.map, z: target });
  });
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const w of writes) w.map.set(OBJECT_FIELDS.z, w.z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Change a sticky's colour. Only the `color` field is written: text, position
 * and stacking are untouched, so the note keeps its place in every sense.
 * Unknown colour names and stale ids return `false` and write nothing.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = readStickyMap(objectsOf(doc), id);
  if (!map) return false;
  if (map.get(OBJECT_FIELDS.color) === color) return false;

  doc.transact(() => {
    map.set(OBJECT_FIELDS.color, color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shared text of a sticky note, for text editing (`applyTextDiff` writes
 * the minimal change into it). `undefined` when there is no such note.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = readStickyMap(objectsOf(doc), id);
  if (!map) return undefined;
  const text = map.get(OBJECT_FIELDS.text);
  return text instanceof Y.Text ? text : undefined;
}

/** Read one object map into a snapshot, or `undefined` when it is not a note. */
function readSnapshot(id: string, map: Y.Map<unknown>): StickySnapshot | undefined {
  if (map.get(OBJECT_FIELDS.type) !== STICKY_TYPE) return undefined;

  const x = map.get(OBJECT_FIELDS.x);
  const y = map.get(OBJECT_FIELDS.y);
  const z = map.get(OBJECT_FIELDS.z);
  const color = map.get(OBJECT_FIELDS.color);
  const createdAt = map.get(OBJECT_FIELDS.createdAt);
  const text = map.get(OBJECT_FIELDS.text);
  const width = map.get(OBJECT_FIELDS.width);
  const height = map.get(OBJECT_FIELDS.height);

  // A malformed object is skipped rather than rendered: a document written by
  // a future version must not take the whole board down.
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  if (!isStickyColor(color)) return undefined;

  const note: StickySnapshot = {
    id,
    type: 'sticky',
    x,
    y,
    color,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
  // Size is optional: a note written before story 7 has no width/height and is
  // left without them, so objectBounds falls back to the default square. A
  // stored size that is present but not a positive number is treated as absent.
  if (isFiniteNumber(width) && width > 0) note.width = width;
  if (isFiniteNumber(height) && height > 0) note.height = height;
  return note;
}

/**
 * Every sticky note as an immutable array, sorted by (z, id) so that two notes
 * with the same z (possible once story 3 syncs concurrent creates) still draw
 * in the same order on every client. Objects of an unknown `type` are skipped:
 * forward compatibility for stories 9-12.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((map, id) => {
    if (!(map instanceof Y.Map)) return;
    const note = readSnapshot(id, map);
    if (note) notes.push(note);
  });
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}

/** A snapshot of any non-sticky object of a known type (id, position, size, z). */
function readObjectSnapshot(id: string, map: Y.Map<unknown>): ObjectSnapshot | undefined {
  const type = map.get(OBJECT_FIELDS.type);
  const x = map.get(OBJECT_FIELDS.x);
  const y = map.get(OBJECT_FIELDS.y);
  const z = map.get(OBJECT_FIELDS.z);
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  const createdAt = map.get(OBJECT_FIELDS.createdAt);
  const snapshot: ObjectSnapshot = {
    id,
    type: type as string,
    x,
    y,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
  const width = map.get(OBJECT_FIELDS.width);
  const height = map.get(OBJECT_FIELDS.height);
  if (isFiniteNumber(width)) snapshot.width = width;
  if (isFiniteNumber(height)) snapshot.height = height;
  return snapshot;
}

/**
 * The whole board as a list of objects of *every* registered type, in drawing
 * order (z, then id). This is what the client renders: story 7 is the first story
 * with more than one kind of object, and the renderer draws each entry through
 * the object registry by its `type`. A sticky note still reads through
 * {@link readSnapshot} so it keeps its `text`/`color`; anything else reads through
 * the generic reader. A map of an unknown type - one this build cannot draw - is
 * skipped, exactly as {@link snapshot} skips it.
 */
export function objectSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((map, id) => {
    if (!(map instanceof Y.Map)) return;
    const type = map.get(OBJECT_FIELDS.type);
    if (type === STICKY_TYPE) {
      const note = readSnapshot(id, map);
      if (note) objects.push(note);
      return;
    }
    if (isKnownObjectType(type)) {
      const object = readObjectSnapshot(id, map);
      if (object) objects.push(object);
    }
  });
  objects.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return objects;
}

/**
 * The world rectangle an object occupies. `width`/`height` are read from the
 * snapshot when present and positive; otherwise the object falls back to its
 * type's default size - a sticky note becomes a `STICKY_SIZE_WORLD` square, which
 * is what makes a note created before story 7 keep its size without any
 * migration (Key decision 5).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const size = defaultObjectSize();
  const width = isFiniteNumber(obj.width) && (obj.width as number) > 0 ? (obj.width as number) : size;
  const height = isFiniteNumber(obj.height) && (obj.height as number) > 0 ? (obj.height as number) : size;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * The ids of the objects lying fully inside `rect`, in snapshot order
 * (`sel.marquee`). "Fully inside" is strict: an object that pokes past any edge,
 * or only touches the marquee's edge, is not returned - `rectContains` requires
 * all four edges of the object to lie within the rectangle.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/**
 * Every selectable object id, for **Select all** (`sel.all`). An entry whose
 * `type` board-model does not know is skipped, so an object written by a future
 * version is never selected by a build that cannot draw or move it.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (isKnownObjectType(obj.type)) ids.push(obj.id);
  }
  return ids;
}
