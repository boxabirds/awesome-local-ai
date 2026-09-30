import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import {
  askedResizeScale,
  clampScale,
  rectContains,
  scaleRectByFactor,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from './geometry';

/**
 * Board document model: the Yjs schema plus every mutation the client (and,
 * from story 4, the Durable Object) performs. Framework-free on purpose so the
 * Durable Object can import it for validation/migration. See design.md "Board
 * document model" (anchor board.model).
 *
 * Schema:
 *   Y.Doc
 *     meta:    Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map> where each value is
 *              { type:'sticky', x, y, color, text: Y.Text, z, createdAt }
 */

/** Transaction origin for local edits (used by story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** The persisted/wire schema version (story 4 migration hook). */
export const SCHEMA_VERSION = 1;

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Absent until something resizes the note; it is then STICKY_SIZE_WORLD. */
  width?: number;
  height?: number;
}

/** An object of any kind. Stories 9-12 add kinds without changing this shape. */
export type BoardObject = StickySnapshot | ObjectSnapshot;

const META = 'meta';
const OBJECTS = 'objects';

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(OBJECTS);

const isSticky = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'sticky';

const isColor = (value: string): value is StickyColor =>
  Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);

/** Is this a number a board can hold? Strings, null and NaN are not. */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const finite = (value: number): boolean => Number.isFinite(value);

/** (z, id) ascending: higher z later; equal z tie-broken by id for stability. */
const compareOrder = (a: { z: number; id: string }, b: { z: number; id: string }): number =>
  a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Create the schema markers if absent. Idempotent: a document that already
 * carries `meta.schemaVersion` gets no transaction (no update event).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
    // Touching `objects` inside the same transaction guarantees it exists in
    // the shared structure so subscribers observe the same top-level type.
    objectsMap(doc);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left = at - half size), on top of
 * every existing note. Returns the new id, or '' when `at` is not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finite(at.x) || !finite(at.y)) return '';

  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    if (isSticky(value)) {
      const z = value.get('z');
      if (typeof z === 'number' && z > maxZ) maxZ = z;
    }
  });

  const id = crypto.randomUUID();
  const note = new Y.Map<unknown>();
  doc.transact(() => {
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ + 1);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * What the model has to know about a kind of object: the smallest it may be
 * made, which is also how the model knows that kind exists at all. The client's
 * object type registry registers a kind here, next to the component that draws
 * it.
 *
 * A kind nothing registered is invisible rather than guessed at: an object from
 * a newer story is neither drawn, selected nor moved on this screen, which is
 * what the design asks for when a document carries a type this story has never
 * heard of.
 */
const minSizes = new Map<string, number>([['sticky', STICKY_MIN_SIZE_WORLD]]);

export const registerObjectTypeModel = (type: string, minSize = 0): void => {
  minSizes.set(type, Math.max(0, num(minSize) ?? 0));
};

/**
 * Reads one object of one type out of its `Y.Map`, beyond the fields every object
 * carries. Filled in by the module that owns the type, which is also how
 * `minSizes` gets filled — so `board-model` never imports a type module and never
 * learns what a text object's extra fields are.
 */
export type ObjectSnapshotReader = (
  id: string,
  object: Y.Map<unknown>,
) => BoardObject | null;

const readers = new Map<string, ObjectSnapshotReader>();

/**
 * Say how a kind of object is read. Without a reader its snapshot is the shared
 * base — position, size and draw order — which is everything a note needs and
 * nothing like enough for a kind that carries text of its own.
 */
export const registerObjectTypeReader = (
  type: string,
  read: ObjectSnapshotReader,
): void => {
  readers.set(type, read);
};

export const isKnownObjectType = (type: unknown): boolean =>
  typeof type === 'string' && minSizes.has(type);

/** The smallest an object of `type` may be made; 0 for a kind with no floor. */
export const objectMinSize = (type: string): number => minSizes.get(type) ?? 0;

export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

/** True for the one kind whose snapshot carries a colour and shared text. */
export const isStickySnapshot = (object: BoardObject): object is StickySnapshot =>
  object.type === 'sticky';

/**
 * Where an object is and how big it is, in world units.
 *
 * A note written before story 7 has no size written at all: it is
 * STICKY_SIZE_WORLD square, and stays that way until something gives it one.
 * Sizes are clamped to MAX_OBJECT_SIZE_WORLD, the one limit a broken object
 * cannot talk its way past.
 */
export function objectBounds(object: ObjectSnapshot): Rect {
  const fallback = STICKY_SIZE_WORLD;
  const width = Math.min(num(object.width) ?? fallback, MAX_OBJECT_SIZE_WORLD);
  const height = Math.min(num(object.height) ?? fallback, MAX_OBJECT_SIZE_WORLD);
  return {
    x: num(object.x) ?? 0,
    y: num(object.y) ?? 0,
    width: width > 0 ? width : fallback,
    height: height > 0 ? height : fallback,
  };
}

/**
 * One object read out of the document, or null for a kind this story has no idea
 * about. Shared by `snapshot` (notes only) and `snapshotObjects` (every kind), so
 * both agree on what an object's fields mean and a note is never read twice with
 * different contents.
 */
function readObject(id: string, object: Y.Map<unknown>): BoardObject | null {
  const base = baseOf(id, object);
  if (base === null) return null;
  const type = object.get('type');
  // A kind that reads itself gets the whole map, because the fields below are not
  // all it has (a text object carries its own text, size and width mode).
  const read = typeof type === 'string' ? readers.get(type) : undefined;
  if (read) return read(id, object);
  if (type !== 'sticky') return base;

  const color = object.get('color');
  const text = object.get('text');
  return {
    ...base,
    type: 'sticky',
    color: isColor(color as string) ? (color as StickyColor) : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    createdAt: num(object.get('createdAt')) ?? 0,
  };
}

/** Objects of every known kind, in draw order: (z, id) ascending. */
function readableObjects(doc: Y.Doc): BoardObject[] {
  const out: BoardObject[] = [];
  objectsMap(doc).forEach((value, key) => {
    if (!(value instanceof Y.Map)) return;
    const read = readObject(key, value as Y.Map<unknown>);
    if (read) out.push(read);
  });
  return out.sort(compareOrder);
}

/**
 * Every object the board can draw and select, of every kind, in draw order. This
 * is what the selection, the overlay, the marquee and a group transform work on;
 * `snapshot` is the notes-only view of the very same read.
 */
export function snapshotObjects(doc: Y.Doc): readonly BoardObject[] {
  return readableObjects(doc);
}

/** Objects that may be selected at all: every kind this screen knows. */
export function allObjectIds(objects: readonly BoardObject[]): string[] {
  return objects
    .filter((object) => isKnownObjectType(object.type))
    .map((object) => object.id);
}

/**
 * Objects lying wholly inside `rect`: the rule a marquee selects by. A note the
 * marquee only covers halfway is not in it, which is what makes a marquee that
 * overshoots one note predictable.
 */
export function objectsInRect(
  objects: readonly BoardObject[],
  rect: Rect,
): string[] {
  return objects
    .filter((object) => isKnownObjectType(object.type))
    .filter((object) => rectContains(rect, objectBounds(object)))
    .map((object) => object.id);
}

/** The smallest box around a selection, or null when nothing in it is there. */
export function selectionBounds(
  objects: readonly BoardObject[],
  ids: readonly string[],
): Rect | null {
  const wanted = new Set(ids);
  return unionRects(
    objects
      .filter((object) => wanted.has(object.id))
      .map((object) => objectBounds(object)),
  );
}

/**
 * Refuse a whole write rather than half-apply it. A gesture that lost its numbers
 * mid-drag must not leave some objects moved and some not: that would be a real
 * change to the board that nobody asked for.
 */
const usable = (values: readonly unknown[]): boolean =>
  values.every((value) => num(value) !== undefined);

/**
 * Move objects to absolute world positions in one transaction, reporting how
 * many actually changed.
 *
 * Positions are absolute rather than a shared offset so that two people moving
 * different selections at the same time converge: each write states where an
 * object is, and the last one simply wins. An object a colleague deleted
 * mid-drag is skipped, not an error: the same change pruned it from my selection.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  let changed = 0;
  doc.transact(() => {
    const objects = objectsMap(doc);
    positions.forEach((position, id) => {
      if (!usable([position.x, position.y])) return;
      const object = objects.get(id);
      if (!(object instanceof Y.Map) || !isKnownObjectType(object.get('type'))) return;
      // Writing the same value again is no change, and would be an operation
      // every collaborator has to merge for nothing.
      if (object.get('x') === position.x && object.get('y') === position.y) return;
      object.set('x', position.x);
      object.set('y', position.y);
      changed += 1;
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Give objects absolute bounds in one transaction: this is what writes a note's
 * width and height the first time it is resized.
 *
 * Each size is clamped between the object's own kind and the one maximum every
 * object shares, so no scale a client asks for can produce a size that cannot be
 * rendered or drawn around.
 */
export function resizeObjects(doc: Y.Doc, sizes: ReadonlyMap<string, Rect>): number {
  if (sizes.size === 0) return 0;
  let changed = 0;
  doc.transact(() => {
    const objects = objectsMap(doc);
    sizes.forEach((rect, id) => {
      const object = objects.get(id);
      if (!(object instanceof Y.Map) || !isKnownObjectType(object.get('type'))) return;
      if (!usable([rect.x, rect.y, rect.width, rect.height])) return;
      const min = objectMinSize(object.get('type') as string);
      const width = Math.min(Math.max(rect.width, min), MAX_OBJECT_SIZE_WORLD);
      const height = Math.min(Math.max(rect.height, min), MAX_OBJECT_SIZE_WORLD);
      if (
        object.get('x') === rect.x &&
        object.get('y') === rect.y &&
        object.get('width') === width &&
        object.get('height') === height
      ) {
        return;
      }
      object.set('x', rect.x);
      object.set('y', rect.y);
      object.set('width', width);
      object.set('height', height);
      changed += 1;
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Every object's *base* fields — position, size, draw order — straight out of the
 * document, without asking a single kind's reader.
 *
 * A kind whose own read depends on where the other objects are has to look at those
 * objects without going through the whole snapshot: a connector is drawn between two
 * shapes, so its reader needs their boxes, and asking `snapshotObjects` from inside a
 * reader would ask its own reader again, and that does not end. Unknown kinds are
 * skipped here exactly as they are in the snapshot.
 */
export function baseObjects(doc: Y.Doc): ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objectsMap(doc).forEach((value, key) => {
    const base = baseOf(key, value);
    if (base) out.push(base);
  });
  return out.sort(compareOrder);
}

/**
 * The fields every object carries, read out of its `Y.Map`, or null for an object of
 * a kind this story has never heard of. `readObject` builds on this; a kind that
 * resolves its own position from the other objects uses it directly.
 */
function baseOf(id: string, value: unknown): ObjectSnapshot | null {
  if (!(value instanceof Y.Map)) return null;
  const type = value.get('type');
  if (!isKnownObjectType(type)) return null;
  const base: ObjectSnapshot = {
    id,
    type: type as string,
    x: num(value.get('x')) ?? 0,
    y: num(value.get('y')) ?? 0,
    z: num(value.get('z')) ?? 0,
  };
  const width = num(value.get('width'));
  const height = num(value.get('height'));
  // Absent on an object nothing has resized; `objectBounds` supplies the default.
  if (width !== undefined) base.width = width;
  if (height !== undefined) base.height = height;
  return base;
}

/**
 * Where every object a board can draw is, as a map of id → rectangle. This is what a
 * connector resolves its ends against, and what an arrow is aimed at.
 */
export function objectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of baseObjects(doc)) {
    const rect = objectBounds(object);
    rects.set(object.id, rect);
  }
  return rects;
}

/**
 * What a kind of object has to say when objects are deleted. Story 10 registers
 * `detachConnectorsTo` here, so that deleting a shape keeps the arrows that pointed
 * at it (`connector.detach`) without `board-model` ever learning what a connector is
 * — the same direction of dependency as `registerObjectTypeModel`, for the same
 * reason: no cycle.
 *
 * Called with the ids being deleted, *before* they are gone, inside the same
 * transaction, so an arrow and the shape it was attached to still agree on where the
 * arrow ended and one undo step reverts both.
 */
export type ObjectDeleteObserver = (doc: Y.Doc, ids: readonly string[]) => void;

const deleteObservers: ObjectDeleteObserver[] = [];

export const registerObjectDeleteObserver = (observer: ObjectDeleteObserver): void => {
  deleteObservers.push(observer);
};

/** Every registered observer, in the order they registered. Nothing to do for none. */
const observeDelete = (doc: Y.Doc, ids: readonly string[]): void => {
  for (const observer of deleteObservers) observer(doc, ids);
};

/** Delete every listed object still there, in one transaction. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  let changed = 0;
  doc.transact(() => {
    const objects = objectsMap(doc);
    const going = [...new Set(ids)];
    // Arrows outlive the shapes they were attached to: their ends are put down first
    // (TC-26), in this same transaction, so one undo brings back both.
    observeDelete(doc, going);
    for (const id of going) {
      const object = objects.get(id);
      if (!(object instanceof Y.Map) || !isKnownObjectType(object.get('type'))) continue;
      objects.delete(id);
      changed += 1;
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Put the selection above every object it is not part of, keeping the order the
 * selected objects had among themselves, in one transaction.
 *
 * Nothing is written when the selection is already all at the front: dragging
 * notes that are already on top costs no operations, which is the common case.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const wanted = new Set(ids);
  const all = readableObjects(doc);
  const selected = all.filter((object) => wanted.has(object.id));
  if (selected.length === 0) return 0;
  const others = all.filter((object) => !wanted.has(object.id));
  const top = others[others.length - 1];
  // `selected` is in draw order, so its first entry is its lowest object.
  if (top === undefined || compareOrder(selected[0], top) > 0) {
    return 0;
  }

  let z = top.z;
  let changed = 0;
  doc.transact(() => {
    const objects = objectsMap(doc);
    for (const object of selected) {
      z += 1;
      const entry = objects.get(object.id);
      if (!(entry instanceof Y.Map) || entry.get('z') === z) continue;
      entry.set('z', z);
      changed += 1;
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Resize a whole selection by the scale a handle drag asked for: every object
 * keeps its place inside the box it was scaled inside, so sizes and the gaps
 * between them change together. Returns null when nothing in the selection is
 * left to resize.
 */
export function resizeSelection(
  objects: readonly BoardObject[],
  ids: readonly string[],
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): ReadonlyMap<string, Rect> | null {
  const wanted = new Set(ids);
  const selected = objects.filter((object) => wanted.has(object.id));
  if (selected.length === 0) return null;
  const start = selectionBounds(objects, ids);
  if (start === null) return null;
  const scale = clampScale(
    askedResizeScale(start, handle, delta, aspectLocked),
    selected.map((object) => objectBounds(object)),
    selected.map((object) => objectMinSize(object.type)),
    MAX_OBJECT_SIZE_WORLD,
  );
  const destination = scaleRectByFactor(start, handle, scale);
  const sizes = new Map<string, Rect>();
  for (const object of selected) {
    sizes.set(object.id, scaleWithin(objectBounds(object), start, destination));
  }
  return sizes;
}

/** Move a note (top-left world coordinates). Rejects stale ids, non-finite. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Raise a note above every other note (z = maxZ + 1). No-op when topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Change a note's colour. Rejects stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isColor(color)) return false;
  const note = objectsMap(doc).get(id);
  if (!isSticky(note)) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. Rejects stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    observeDelete(doc, [id]);
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared Y.Text, or undefined for a missing / non-note id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!isSticky(note)) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * An immutable snapshot of every sticky note, sorted by (z, id) ascending so
 * the renderer paints lowest-first (the last entry is on top). Objects with an
 * unknown `type` are skipped (forward compatibility for stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return readableObjects(doc).filter(isStickySnapshot);
}
