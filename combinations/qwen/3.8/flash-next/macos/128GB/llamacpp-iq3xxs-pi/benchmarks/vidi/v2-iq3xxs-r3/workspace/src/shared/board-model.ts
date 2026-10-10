/**
 * Board document model: the Yjs schema and every mutation the board performs.
 *
 * Framework-free on purpose — the client imports it now, and from story 4 the
 * Durable Object uses the same module for validation and migration. The schema
 * below is the future persisted (story 4) and wire (story 3) format, which is
 * why `meta.schemaVersion` exists from day one.
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map>, one entry per object:
 *       type: 'sticky'
 *       x: number, y: number     // top-left, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number                // stacking; higher is on top
 *       createdAt: number        // epoch ms
 *
 * Every successful mutation runs in one `doc.transact(fn, LOCAL_ORIGIN)`;
 * rejections (stale id, unknown colour, non-finite coordinates, pointless
 * bringToFront) return `false` before opening a transaction and emit no
 * update. The module never throws for user-driven input.
 */

import * as Y from 'yjs';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';
import { rectContains } from './geometry';
import type { Point, Rect } from './geometry';

/** Document keys of the board schema. */
export const META_KEY = 'meta';
export const OBJECTS_KEY = 'objects';

/** Current document format version (story 4 migrates from older ones). */
export const SCHEMA_VERSION = 1;

/** Note type key; the renderer skips entries of any other type. */
export const STICKY_TYPE = 'sticky';

/**
 * The object types this build's board model can read. Stories 9-12 add theirs
 * here as they add them; a type that is in the document but not in this set is
 * shown by nobody and selectable by nobody (`sel.all_types`).
 */
export const MODEL_OBJECT_TYPES: ReadonlySet<string> = new Set([STICKY_TYPE]);

/** Whether `type` is one of `MODEL_OBJECT_TYPES`. */
export function isModelObjectType(type: string): boolean {
  return MODEL_OBJECT_TYPES.has(type);
}

/**
 * Transaction origin for mutations done by this client. Story 8 wires undo
 * managers to it and story 3 uses it to avoid echoing changes back.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/**
 * Any board object as rendered: the immutable view of one `objects` entry, with
 * the geometry every object has whatever its type. Stories 9-12 add types whose
 * entries look like this; the fields past `createdAt` belong to one type and are
 * absent for the others.
 *
 * `width`/`height` are *optional* and mean "explicitly sized": a note created
 * before story 7 has neither and renders at its type's default size
 * (`objectBounds`), and the first resize writes both (story 7, key decision 5).
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly createdAt: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/** A note as rendered: the immutable view of one `objects` entry. */
export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
}

type ObjectMap = Y.Map<unknown>;

/** True for values that can safely be written as coordinates. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

/** The entry for `id`, or undefined when it is missing or not a Y.Map. */
function objectOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const entry = objectsOf(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
}

/** True when `color` is one of the six configured colour names. */
function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && Object.hasOwn(STICKY_COLORS, color);
}

/** Current `z` of an entry, or 0 when absent/non-finite. */
function zOf(entry: ObjectMap): number {
  return typeof entry.get('z') === 'number' ? (entry.get('z') as number) : 0;
}

/** Highest `z` in the document; 0 for an empty document, so the first z is 1. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    if (entry instanceof Y.Map) max = Math.max(max, zOf(entry));
  }
  return max;
}

/**
 * Prepare the document: sets `meta.schemaVersion` when absent, in one
 * transaction. Calling it again on an initialised doc changes nothing.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a yellow (unless recoloured now) sticky note *centred* on `at`
 * (world units), on top of every other note. The stored `x`/`y` are the
 * top-left, i.e. `at` minus half the note size.
 *
 * Returns the new id, or `false` when the coordinates are not finite
 * (TC-39) — the design contract allows `createSticky` to reject input, so its
 * return type is `string | false` rather than a bare `string`.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  if (!isStickyColor(color)) return false;

  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', STICKY_TYPE);
    note.set('x', x);
    note.set('y', y);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', createdAt);
    objectsOf(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/* --- Story 7: geometry and group operations ----------------------------- */

/**
 * The side an object of a type is drawn at when nothing has sized it. A note
 * created before story 7 has no `width`/`height` stored at all, and stays
 * `STICKY_SIZE_WORLD` until someone resizes it (key decision 5), so the default
 * belongs to the type, not to the object.
 *
 * A type the board model does not know falls back to the note size: an object
 * with no size of its own is drawn at the size the board was made at, and a
 * later story that adds a type with a different default says so here.
 */
export const DEFAULT_SIZE_WORLD_BY_TYPE: ReadonlyMap<string, number> = new Map([
  [STICKY_TYPE, STICKY_SIZE_WORLD],
]);

/** The default side of `type`. */
export function defaultSizeOf(type: string): number {
  return DEFAULT_SIZE_WORLD_BY_TYPE.get(type) ?? STICKY_SIZE_WORLD;
}

/**
 * The rectangle one object occupies, in world units: its stored `x`/`y` plus its
 * stored size, or its type's default size when nothing has sized it.
 */
export function objectBounds(object: ObjectSnapshot): Rect {
  const x = isFiniteNumber(object.x) ? object.x : 0;
  const y = isFiniteNumber(object.y) ? object.y : 0;
  const size = defaultSizeOf(object.type);
  const width = isFiniteNumber(object.width) && object.width > 0 ? object.width : size;
  const height = isFiniteNumber(object.height) && object.height > 0 ? object.height : size;
  return { x, y, width, height };
}

/**
 * Narrow an object read back from the document to a note. `objectSnapshots`
 * keeps a note's colour and text (they are in the same entry), and the client
 * that renders by type needs to know which fields it may reach for.
 */
export function isStickySnapshot(object: ObjectSnapshot): object is StickySnapshot {
  return object.type === STICKY_TYPE && typeof (object as StickySnapshot).color === 'string';
}

/** One entry of any type as an object, or `undefined` when it is malformed. */
function toObjectSnapshot(id: string, entry: ObjectMap): ObjectSnapshot | undefined {
  const type = entry.get('type');
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  if (typeof type !== 'string') return undefined;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  if (!isFiniteNumber(createdAt)) return undefined;
  return {
    id,
    type,
    x,
    y,
    z,
    createdAt,
    width: sizeOf(entry, 'width'),
    height: sizeOf(entry, 'height'),
  };
}

/** Notes in `doc` sorted by `(z, id)`; malformed and non-note entries skipped. */
function compareObjects(a: ObjectSnapshot, b: ObjectSnapshot): number {
  return a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z;
}

/**
 * Every object in the document, of every type, sorted by `(z, id)` like
 * `snapshot` sorts notes. Unknown types are *kept* here — the client's registry
 * decides what it can draw, and `allObjectIds` is the function that refuses to
 * select what nothing could draw. A note keeps its `color` and `text`, because
 * they live in the same entry and the renderer reads them from the snapshot.
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!(entry instanceof Y.Map)) continue;
    // A note keeps its own fields; anything else is read generically. Both are
    // `ObjectSnapshot`s, so the selection code never asks which one it got.
    const note = toSnapshot(id, entry);
    const object = note ?? toObjectSnapshot(id, entry);
    if (object) objects.push(object);
  }
  objects.sort(compareObjects);
  return objects;
}

/**
 * The ids of the objects lying *entirely* inside `rect` (`sel.marquee`), in the
 * order `snapshot` puts them: an object that is only partly inside, or merely
 * touches the edge from outside, is not among them.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snapshot
    .filter((object) => rectContains(rect, objectBounds(object)))
    .map((object) => object.id);
}

/**
 * The ids select-all may claim (`sel.all`, `sel.all_types`): the objects of a
 * type this build knows — `isSelectable`, which defaults to the types the board
 * model can read — and never an object nothing could draw.
 */
export function allObjectIds(
  snapshot: readonly ObjectSnapshot[],
  isSelectable: (type: string) => boolean = isModelObjectType,
): string[] {
  return snapshot.filter((object) => isSelectable(object.type)).map((object) => object.id);
}

/**
 * The entries a write may proceed with: `undefined` when the request must be
 * refused as a whole (a value that is not a number means the gesture, not the
 * object, is broken), and entries whose value already matches left out (a
 * gesture that changed nothing costs story 3 no sync traffic).
 */
function writableEntries<Value>(
  doc: Y.Doc,
  requested: ReadonlyMap<string, Value>,
): Array<[string, ObjectMap, Value]> | undefined {
  if (requested.size === 0) return undefined;
  const targets: Array<[string, ObjectMap, Value]> = [];
  for (const [id, value] of requested) {
    if (value === null || value === undefined) return undefined;
    const entry = objectOf(doc, id);
    if (!entry) continue; // another person deleted it mid-gesture
    targets.push([id, entry, value]);
  }
  return targets.length > 0 ? targets : undefined;
}

/**
 * Write absolute positions (`sel.group_move`, and the arrow-key nudge): one
 * transaction for the whole group, objects another person deleted skipped, and
 * *no* transaction at all when any requested position is not a number, when the
 * list is empty, or when every object is already where it is asked to be.
 * Returns how many objects moved.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const requested = new Map<string, Point>();
  for (const [id, at] of positions) {
    if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return 0;
    requested.set(id, { x: at.x, y: at.y });
  }
  const targets = writableEntries(doc, requested);
  if (!targets) return 0;
  const moved = targets.filter(
    ([, entry, at]) => entry.get('x') !== at.x || entry.get('y') !== at.y,
  );
  if (moved.length === 0) return 0;
  doc.transact(() => {
    for (const [, entry, at] of moved) {
      entry.set('x', at.x);
      entry.set('y', at.y);
    }
  }, LOCAL_ORIGIN);
  return moved.length;
}

/**
 * Write absolute rectangles (`sel.resize`): one transaction, and writing
 * `width` and `height` is what turns an implicitly-sized object into an
 * explicitly sized one (key decision 5). Refused as a whole if any rectangle is
 * not a rectangle — a side of nought included — because half a resized selection
 * is a selection that does not line up. Objects already at the requested
 * rectangle are not counted and do not cause a transaction. Returns how many
 * objects changed.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const requested = new Map<string, Rect>();
  for (const [id, rect] of rects) {
    if (!rect || !isFiniteNumber(rect.x) || !isFiniteNumber(rect.y)) return 0;
    if (!isFiniteNumber(rect.width) || rect.width <= 0) return 0;
    if (!isFiniteNumber(rect.height) || rect.height <= 0) return 0;
    requested.set(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  const targets = writableEntries(doc, requested);
  if (!targets) return 0;
  const resized = targets.filter(([, entry, rect]) => {
    const width = sizeOf(entry, 'width');
    const height = sizeOf(entry, 'height');
    return (
      entry.get('x') !== rect.x ||
      entry.get('y') !== rect.y ||
      width !== rect.width ||
      height !== rect.height
    );
  });
  if (resized.length === 0) return 0;
  doc.transact(() => {
    for (const [, entry, rect] of resized) {
      entry.set('x', rect.x);
      entry.set('y', rect.y);
      entry.set('width', rect.width);
      entry.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return resized.length;
}

/**
 * Raise `ids` above every object that is not in `ids`, keeping their order among
 * themselves (`sel.group_move`: a cluster dragged across the board stays in the
 * order it was in, and lands on top of what it covered). One transaction, and no
 * transaction when the selection is already above everything else — which is the
 * usual case, and the reason a drag costs story 3 one update rather than none.
 * Returns how many objects were restacked.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: Array<{ entry: ObjectMap; z: number; id: string }> = [];
  let highestOther = 0;
  for (const [id, entry] of objectsOf(doc)) {
    if (!(entry instanceof Y.Map)) continue;
    if (wanted.has(id)) selected.push({ entry, z: zOf(entry), id });
    else highestOther = Math.max(highestOther, zOf(entry));
  }
  if (selected.length === 0) return 0;
  if (selected.every((object) => object.z > highestOther)) return 0;
  // Their own stacking order is kept by giving them the next z values in it.
  selected.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : 1) : a.z - b.z));
  const first = maxZ(doc) + 1;
  doc.transact(() => {
    selected.forEach((object, index) => {
      object.entry.set('z', first + index);
    });
  }, LOCAL_ORIGIN);
  return selected.length;
}

/**
 * Remove every object named (`sel.group_delete`): one transaction for the whole
 * deletion, and objects that are not there (another person deleted them, or the
 * selection was stale) skipped. Unknown types are deletable — they are on the
 * board, and leaving an object nobody can draw would be the cruel reading.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const present = [...new Set(ids)].filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Move one object to world coordinates (top-left) — the same write as
 * `moveObjects`, with one id (story 7, key decision 3: one behaviour, two
 * arities, so story 2's single-object callers kept working unchanged).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/**
 * Restack `id` above every other object. `false` when the note is already
 * topmost (its `z` equals the maximum) so a drag over one's own note costs
 * story 3 no sync traffic.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/**
 * Set the note colour (sticky.color). Text, position, stacking and any local
 * selection are untouched; unknown colour names and stale ids are rejected
 * without a transaction.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objectOf(doc, id);
  if (!note || note.get('type') !== STICKY_TYPE) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove one object from `objects` (sticky.delete) — `deleteObjects`, with one id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** The `Y.Text` holding the note's text, for text editing to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectOf(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The persisted size, when this object has one; absent means "type default". */
function sizeOf(entry: ObjectMap, key: 'width' | 'height'): number | undefined {
  const value = entry.get(key);
  return isFiniteNumber(value) && value > 0 ? value : undefined;
}

function toSnapshot(id: string, entry: ObjectMap): StickySnapshot | undefined {
  if (entry.get('type') !== STICKY_TYPE) return undefined; // unknown type: skipped (TC-12)
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const color = entry.get('color');
  const text = entry.get('text');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  if (!isFiniteNumber(createdAt)) return undefined;
  if (!isStickyColor(color)) return undefined;
  const width = sizeOf(entry, 'width');
  const height = sizeOf(entry, 'height');
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    color,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt,
    width,
    height,
  };
}

/**
 * The notes to render, sorted by `(z, id)` so equal `z` values — possible
 * once story 3 syncs concurrent creation — still order identically on every
 * client. Unknown object types are skipped (forward compatibility for
 * stories 9–12). Immutable until the document changes.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!(entry instanceof Y.Map)) continue;
    const note = toSnapshot(id, entry);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}
