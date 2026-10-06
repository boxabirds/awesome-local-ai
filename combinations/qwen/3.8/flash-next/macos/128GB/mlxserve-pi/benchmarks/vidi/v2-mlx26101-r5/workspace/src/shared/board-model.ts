/**
 * The board document model: the Yjs schema plus every mutation the UI can
 * perform on a board object.
 *
 * Framework-free on purpose — the Durable Object (story 4) imports this module
 * for validation and migration, and the client renders an immutable snapshot of
 * it. One successful mutation is one `doc.transact(fn, LOCAL_ORIGIN)`; rejected
 * mutations (stale id, unknown colour, non-finite coordinates, pointless
 * re-stacking) return before a transaction is opened, so they emit no update.
 *
 * Schema (this is the format story 4 persists and story 3 syncs):
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map> where each value is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 */

import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type StickyColor,
} from './config';
import type { Point, Rect } from './geometry';
import { rectContains } from './geometry';
import type { TextSize, TextSnapshot } from './objects/text';

/** Name of the `Y.Map` holding `{ schemaVersion }`. */
export const META_MAP = 'meta';
/** Name of the `Y.Map<id, Y.Map>` holding the board objects. */
export const OBJECTS_MAP = 'objects';
/** `meta.schemaVersion` written by {@link initDoc}. */
export const SCHEMA_VERSION = 1;
/** The only `type` value this story renders; unknown types are skipped. */
export const STICKY_TYPE = 'sticky';
/**
 * The `type` value of a free text object (story 9).
 *
 * Spelled here rather than imported from `./objects/text`: the snapshot has to name the type it is
 * reading, and that file imports this one. The import above is a type-only one for the same reason —
 * the two files share a schema, not code.
 */
export const TEXT_TYPE = 'text';

/** Transaction origin of every local mutation (story 8 undo, story 3 echo guard). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/**
 * Any board object, as rendered by the client.
 *
 * Every object type has these fields; a type adds its own on top (a sticky note has `color`
 * and `text`). `width`/`height` are optional because notes written before story 7 have neither
 * and are still {@link STICKY_SIZE_WORLD} wide — see {@link objectBounds}.
 */
export interface ObjectSnapshot {
  id: string;
  /** Registry key: 'sticky' today, 'text' / 'shape' / 'draw' / 'image' later. */
  type: string;
  /** Top-left corner in world units. */
  x: number;
  y: number;
  /** Width in world units; undefined means the object has never been resized. */
  width?: number;
  height?: number;
  /** Stacking order; higher is drawn on top. */
  z: number;
  createdAt: number;
}

/** One sticky note, as rendered by the client. */
export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

/**
 * The object types this build knows about.
 *
 * A board written by a newer client can hold a type this one has never heard of; the snapshot
 * still lists it (so nothing silently deletes it) but nothing selects or renders it. The client
 * registry ({@link declareObjectType}) adds the types it can draw, which is how *select all*
 * knows what it is allowed to select.
 */
const knownObjectTypes = new Set<string>([STICKY_TYPE, TEXT_TYPE]);

/** Says that this build can render `type`; called once per type by the registry. */
export function declareObjectType(type: string): void {
  knownObjectTypes.add(type);
}

/** True when an object of `type` is one this build knows about. */
export function isKnownObjectType(type: string): boolean {
  return knownObjectTypes.has(type);
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** True when `value` is one of the six preset colour names. */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;

/** The raw entry for `id`, or undefined when absent or of an unknown shape. */
function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map && value.get('type') === STICKY_TYPE ? value : undefined;
}

/** Largest `z` in the document (0 when there are no objects). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of objectsOf(doc).values()) {
    const z: unknown = value instanceof Y.Map ? value.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/** Creates the document's root maps; sets `meta.schemaVersion` once. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
  // Touch the objects map so it exists in the document from the start.
  objectsOf(doc);
}

/**
 * Creates a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD / 2)
 * on top of every other note. Returns the new id, or `false` when the point is
 * not a finite coordinate.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !finite(at.x) || !finite(at.y)) return false;
  const id = crypto.randomUUID();
  const ytext = new Y.Text();
  const map = new Y.Map<unknown>();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    map.set('type', STICKY_TYPE);
    map.set('x', at.x - STICKY_SIZE_WORLD / 2);
    map.set('y', at.y - STICKY_SIZE_WORLD / 2);
    map.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    map.set('text', ytext);
    map.set('z', z);
    map.set('createdAt', Date.now());
    objectsOf(doc).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note to world `(x, y)`. False when rejected or a no-op. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  if (!finite(x) || !finite(y)) return false;
  if (map.get('x') === x && map.get('y') === y) return false;
  doc.transact(() => {
    map.set('x', x);
    map.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Re-stacks a note above every other note. False when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  const z: unknown = map.get('z');
  const top = maxZ(doc);
  if (typeof z === 'number' && z >= top) return false;
  doc.transact(() => {
    map.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Changes only the colour of a note. False for a stale id or unknown colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  if (!isStickyColor(color)) return false;
  if (map.get('color') === color) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object. False when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or `undefined` when the id is not a sticky note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = entryOf(doc, id);
  const ytext: unknown = map?.get('text');
  return ytext instanceof Y.Text ? ytext : undefined;
}

/** Immutable snapshot of every object, sorted by `(z, id)`; unknown types are listed as-is. */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  for (const [id, value] of objectsOf(doc)) {
    if (!(value instanceof Y.Map)) continue; // not an object at all: forward compatibility
    const type: unknown = value.get('type');
    const x = finite(value.get('x')) ? (value.get('x') as number) : 0;
    const y = finite(value.get('y')) ? (value.get('y') as number) : 0;
    const z = finite(value.get('z')) ? (value.get('z') as number) : 0;
    const createdAt = finite(value.get('createdAt')) ? (value.get('createdAt') as number) : 0;
    // An object written before story 7 has no size of its own; `objectBounds` supplies the
    // size its type was born with, and the first resize writes both fields.
    const width = finite(value.get('width')) ? (value.get('width') as number) : undefined;
    const height = finite(value.get('height')) ? (value.get('height') as number) : undefined;
    if (type === TEXT_TYPE) {
      // A text object carries its own text, its size preset and its width mode; a document written by a
      // client that knew a size or a mode this one does not reads as the default of each, so the
      // renderer always gets something it can draw.
      const ytext: unknown = value.get('text');
      const size: unknown = value.get('size');
      const widthMode: unknown = value.get('widthMode');
      const text: TextSnapshot = {
        id,
        type: TEXT_TYPE,
        x,
        y,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        z,
        createdAt,
        text: ytext instanceof Y.Text ? ytext.toString() : '',
        size:
          typeof size === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)
            ? (size as TextSize)
            : DEFAULT_TEXT_SIZE,
        widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
      };
      objects.push(text);
      continue;
    }
    if (type !== STICKY_TYPE) {
      // Stories 10-12 objects (and anything a newer client wrote): listed so that they are
      // counted and can be found, skipped by the renderer and by select-all.
      objects.push({
        id,
        type: typeof type === 'string' ? type : '',
        x,
        y,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        z,
        createdAt,
      });
      continue;
    }
    const ytext: unknown = value.get('text');
    const color: unknown = value.get('color');
    const sticky: StickySnapshot = {
      id,
      type: STICKY_TYPE,
      x,
      y,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      z,
      createdAt,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: ytext instanceof Y.Text ? ytext.toString() : '',
    };
    objects.push(sticky);
  }
  // `(z, id)` so two clients that merged equal z values still agree on order.
  objects.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return objects;
}

/**
 * Is this object a sticky note? Which is a question about its `type` field and nothing else — the
 * snapshot answers for every object on the board now, and the code that draws, colours or edits a
 * note needs to know which of them are notes.
 */
export function isStickySnapshot(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === STICKY_TYPE;
}

/**
 * Is this object a piece of text? The same kind of question as the one above, and the reason it is here
 * rather than in `objects/text.ts` is who asks it: the selection bar (is the one thing selected a text
 * object, does it get the size buttons), the resize gesture (do these objects take a width and give back
 * a height) and the board (does this one get the toolbar of one text object). All of them are holding a
 * snapshot they read off the board and need to know which of its shapes it is.
 */
export function isTextSnapshot(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === TEXT_TYPE;
}

/* ------------------------------------------------------------------ objects, in groups (story 7) */

/**
 * The size an object has when the document does not say.
 *
 * Notes written before story 7 carry no `width`/`height`; every object of every type is born
 * {@link STICKY_SIZE_WORLD} on a side, so that is the answer, and the first resize writes both
 * fields explicitly. Stories 9–12 can give their types a different default by writing a size when
 * they create one.
 */
const DEFAULT_SIZE_WORLD = STICKY_SIZE_WORLD;

/** The rectangle an object occupies, in world units. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: finite(obj.x) ? obj.x : 0,
    y: finite(obj.y) ? obj.y : 0,
    width: finite(obj.width) ? (obj.width as number) : DEFAULT_SIZE_WORLD,
    height: finite(obj.height) ? (obj.height as number) : DEFAULT_SIZE_WORLD,
  };
}

/**
 * Ids of the objects that lie **entirely** inside `rect`, in stacking order.
 *
 * The marquee's rule from the PRD: something the rectangle only half covers is not selected.
 * Objects this build cannot draw are answered too — they are on the board, and a later story that
 * can draw them must find the same answer here.
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  return objects.filter((obj) => rectContains(rect, objectBounds(obj))).map((obj) => obj.id);
}

/**
 * Ids of every object this build knows about, in stacking order: what *select all* selects.
 *
 * An object of a type no registered renderer claims is left out rather than selected and then not
 * drawn, which would look like a selection that ignores half the board and would let a person
 * delete what they cannot see.
 */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.filter((obj) => isKnownObjectType(obj.type)).map((obj) => obj.id);
}

const zOf = (map: Y.Map<unknown>): number => {
  const z: unknown = map.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
};

/** Highest `z` among the objects that are not in `except` (0 when there are none). */
function maxZExcept(doc: Y.Doc, except: ReadonlySet<string>): number {
  let max = 0;
  for (const [id, value] of objectsOf(doc)) {
    if (except.has(id)) continue;
    if (!(value instanceof Y.Map)) continue;
    max = Math.max(max, zOf(value));
  }
  return max;
}

/**
 * Moves objects to absolute world positions, in one transaction.
 *
 * A position is absolute rather than a delta, which is what lets two people drag two different
 * groups at the same time and still end up with the board in the same place. An id that is no
 * longer in the document is skipped — the person next to us may have deleted the object while we
 * were dragging it — and so is a position that is not a number, which would corrupt the document
 * for everyone.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (!positions || positions.size === 0) return 0;
  const objects = objectsOf(doc);
  // Decided up front, so that one transaction holds all of it or does not happen at all.
  const writes: [Y.Map<unknown>, Point][] = [];
  for (const [id, position] of positions) {
    if (!position || !finite(position.x) || !finite(position.y)) continue;
    const map: unknown = objects.get(id);
    if (!(map instanceof Y.Map)) continue;
    if (map.get('x') === position.x && map.get('y') === position.y) continue;
    writes.push([map, position]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [map, position] of writes) {
      map.set('x', position.x);
      map.set('y', position.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Gives objects an explicit position *and size*, in one transaction.
 *
 * Both size fields are written together, because an object with a width and no height is half a
 * resize. Objects that have never been resized have no size in the document; this is what writes
 * it for the first time.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (!rects || rects.size === 0) return 0;
  const objects = objectsOf(doc);
  const writes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, rect] of rects) {
    if (
      !rect ||
      !finite(rect.x) ||
      !finite(rect.y) ||
      !finite(rect.width) ||
      !finite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      continue;
    }
    const map: unknown = objects.get(id);
    if (!(map instanceof Y.Map)) continue;
    if (
      map.get('x') === rect.x &&
      map.get('y') === rect.y &&
      map.get('width') === rect.width &&
      map.get('height') === rect.height
    ) {
      continue;
    }
    writes.push([map, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [map, rect] of writes) {
      map.set('x', rect.x);
      map.set('y', rect.y);
      map.set('width', rect.width);
      map.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Puts the named objects above every object not named, in one transaction, keeping the order the
 * selection already had among itself.
 *
 * This is the whole of "the group comes to the front" when a group is dragged. Doing it one object
 * at a time would work, but it would write one transaction per object — and each one is a message
 * to everybody else — and it would restack the objects against each other, which nobody asked for.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const selected: [string, Y.Map<unknown>][] = [];
  for (const id of new Set(ids)) {
    const value: unknown = objects.get(id);
    if (value instanceof Y.Map) selected.push([id, value]);
  }
  if (selected.length === 0) return 0;
  const chosen = new Set(selected.map(([id]) => id));
  const above = maxZExcept(doc, chosen);
  // Bottom of the group first, so rank 1 (just above everything else) goes to the lowest.
  const ordered = [...selected].sort((a, b) => zOf(a[1]) - zOf(b[1]) || (a[0] < b[0] ? -1 : 1));
  const writes: [Y.Map<unknown>, number][] = ordered
    .map(([, map], rank) => [map, above + rank + 1] as [Y.Map<unknown>, number])
    .filter(([map, z]) => map.get('z') !== z);
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [map, z] of writes) map.set('z', z);
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Removes objects, in one transaction, and says how many were there to remove.
 *
 * Everything the object owned went with it: a sticky note's text lives inside the object's own map
 * in the document, so deleting the object deletes its content. An id that is not in the document
 * is not an error — it is what happens when the same Delete key reaches two people at once.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const present: string[] = [];
  for (const id of new Set(ids)) {
    if (objects.get(id) instanceof Y.Map) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
