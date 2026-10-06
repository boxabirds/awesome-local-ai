/**
 * The board document model: the Yjs schema plus every mutation the app can
 * perform on board content.
 *
 * The document is the single source of truth for board content, in this story
 * held in memory only. Story 3 attaches a network provider to the same document
 * and story 4 persists it, which is why the schema carries `meta.schemaVersion`
 * and every mutation runs in one transaction tagged with `LOCAL_ORIGIN`.
 *
 * Schema:
 *   meta:    Y.Map { schemaVersion: number }
 *   objects: Y.Map<id, Y.Map> where each object Y.Map holds
 *            type: string          ('sticky', 'text'; unknown types are ignored)
 *            x, y: number          (top-left, world units)
 *            width, height: number (world units; a note's default size is implied)
 *            z: number             (stacking; higher is drawn on top)
 *            createdAt: number     (epoch ms)
 *          plus whatever the type itself keeps, read by that type's own reader:
 *            color: StickyColor, text: Y.Text                                        (sticky)
 *            size: 'S'|'M'|'L'|'XL', widthMode: 'auto'|'fixed', text: Y.Text         (text)
 *            kind, fill, stroke, label: Y.Text                                       (shape)
 *            from, to: end Y.Map { attached to an id, or a point on the board }      (connector)
 *
 * Rules that every mutation follows:
 *  - invalid input (stale id, unknown colour, non-finite coordinate) returns
 *    `false` *before* a transaction is opened, so a rejection costs no update
 *    and no sync traffic;
 *  - a successful mutation is exactly one `doc.transact(..., LOCAL_ORIGIN)`;
 *  - nothing here throws for user-driven input.
 *
 * Framework-free on purpose: the Durable Object (story 4) imports this module
 * for validation and migration, so it must never touch React or the DOM.
 */

import * as Y from 'yjs';
import { rectContains, type Point, type Rect } from './geometry';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor
} from './config';

/** Transaction origin for changes made by this client (story 8 undo, story 3 echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** The object type this story renders; unknown types are skipped (stories 9-12). */
export const STICKY_OBJECT_TYPE = 'sticky';

/**
 * The parts every board object has, whatever it turns out to be: where it is, how
 * it stacks, and how big it is. `width` and `height` are optional because notes
 * made before story 7 carry neither and render at their type's default size; the
 * first resize writes both (sel.size_limits).
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width?: number;
  readonly height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
  readonly createdAt: number;
}

export interface PointLike {
  readonly x: number;
  readonly y: number;
}

type ObjMap = Y.Map<unknown>;

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Is `color` one of the six preset colour names? */
export function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && (COLOR_NAMES as string[]).includes(color);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The document's object map, creating it if the doc has never been initialised. */
function objectsOf(doc: Y.Doc): Y.Map<ObjMap> {
  return doc.getMap('objects') as Y.Map<ObjMap>;
}

function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

/** The object's own `Y.Map`, or undefined for an id that is not on the board. */
export function objectMap(doc: Y.Doc, id: string): ObjMap | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const value = objectsOf(doc).get(id);
  return value instanceof Y.Map ? (value as ObjMap) : undefined;
}

/** The highest `z` in the document, or 0 when there are no objects. */
export function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objectsOf(doc).values()) {
    const z = object.get('z');
    if (isFiniteNumber(z) && z > top) top = z;
  }
  return top;
}

/** Create the document's maps and set `meta.schemaVersion` if it is absent. */
export function initDoc(doc: Y.Doc): void {
  // Creating a Y.Map is a no-op when it already exists, and writing the version
  // inside one transaction keeps an empty doc to a single update.
  doc.transact(() => {
    const meta = metaOf(doc);
    objectsOf(doc);
    if (typeof meta.get('schemaVersion') !== 'number') {
      meta.set('schemaVersion', BOARD_SCHEMA_VERSION);
    }
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on `at` (the stored top-left is `at` minus half the
 * note size), on top of every other note. Returns the new id, or '' when the
 * coordinates are not finite numbers.
 */
export function createSticky(doc: Y.Doc, at: PointLike, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  if (!isStickyColor(color)) return '';

  const id = createId();
  const top = maxZ(doc) + 1;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', STICKY_OBJECT_TYPE);
    object.set('x', at.x - STICKY_SIZE_WORLD / 2);
    object.set('y', at.y - STICKY_SIZE_WORLD / 2);
    object.set('color', color);
    object.set('text', new Y.Text());
    // Story 7: a note made from now on carries its own size, so it can be resized.
    object.set('width', STICKY_SIZE_WORLD);
    object.set('height', STICKY_SIZE_WORLD);
    object.set('z', top);
    object.set('createdAt', Date.now());
    objectsOf(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to a new top-left. False for a stale id or non-finite numbers. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Give a note the highest `z`. False when it is already topmost or missing. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Change a note's colour. False for a stale id or an unknown colour name. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const object = objectMap(doc, id);
  if (!object) return false;
  if (!isStickyColor(color)) return false;
  if (object.get('color') === color) return false;
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/* ------------------------------------------------- generic object operations (story 7) */

/** The object types this build knows about. See `declareObjectType`. */
const declaredTypes = new Set<string>([STICKY_OBJECT_TYPE]);

/**
 * How one object type reads its own fields out of the `Y.Map`.
 *
 * The shared model knows the parts every object has — position, size, layer — and
 * nothing about the rest, because the code that owns a type is the code that knows
 * what it stores. A type that declares no reader is read as its common fields only.
 * Returning `null` means "this is not a readable object of that type", which leaves
 * it out of every snapshot rather than half-drawn.
 */
export type ObjectSnapshotReader = (
  object: ObjMap,
  common: ObjectSnapshot,
  context?: SnapshotContext
) => ObjectSnapshot | null;

/**
 * What the rest of the board looks like while a snapshot is being read: where every
 * object is, by id.
 *
 * Most types need none of it — a note is a box, and it knows where its box is. A type
 * whose bounds come from *other* objects needs them, which is the case for an arrow
 * (`connector.model`): it stores the two objects it is tied to, so the line it occupies
 * is only known once the shapes it points at are known too. Passing the map in rather
 * than letting the reader walk the document keeps one walk per snapshot and keeps the
 * reader a pure function of the document it was handed.
 */
export interface SnapshotContext {
  readonly rects: ReadonlyMap<string, Rect>;
}

const objectReaders = new Map<string, ObjectSnapshotReader>();

/**
 * Say that this build can render an object type.
 *
 * `snapshot` only ever returns declared types, so an object written by a newer
 * client is skipped here rather than rendered half-understood, and select-all
 * cannot pick something the screen cannot show. The client object registry
 * (`src/client/objects/registry.tsx`) calls this as it registers a type, so there
 * is one list and it stays framework-free — the Worker imports this module.
 *
 * A type with fields of its own passes the reader for them (story 9's free text
 * does), which is how a later story extends the schema without this file knowing
 * the type exists.
 */
export function declareObjectType(type: string, read?: ObjectSnapshotReader): void {
  if (typeof type !== 'string' || type === '') return;
  declaredTypes.add(type);
  if (read) objectReaders.set(type, read);
}

/** Can this build render objects of `type`? */
export function isDeclaredObjectType(type: string): boolean {
  return declaredTypes.has(type);
}

/**
 * Where an object is and how big it is. A note made before story 7 carries neither
 * `width` nor `height` and renders at `STICKY_SIZE_WORLD`, which is what keeps an
 * old board the size it was on the day this story shipped (`sel.size_limits`).
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = isFiniteNumber(obj.width) ? (obj.width as number) : STICKY_SIZE_WORLD;
  const height = isFiniteNumber(obj.height) ? (obj.height as number) : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * The ids of every object lying *entirely* inside `rect`, in document order
 * (`sel.marquee`). An object that only overhangs, or that the rectangle touches from
 * outside, is not selected: half an object is not an object you asked for.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const inside: string[] = [];
  for (const object of snapshot) {
    if (rectContains(rect, objectBounds(object))) inside.push(object.id);
  }
  return inside;
}

/**
 * The ids select-all takes (`sel.all`): every object this build knows how to render.
 * An object of a type from a later story, or one this client has never heard of, is
 * left out — selecting something the screen cannot show would put a bounding box
 * around nothing.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((object) => isDeclaredObjectType(object.type)).map((object) => object.id);
}

/** Every id in `wanted` that is actually on the board, in the order given. */
function presentIds(doc: Y.Doc, wanted: Iterable<string>): string[] {
  const present: string[] = [];
  const seen = new Set<string>();
  for (const id of wanted) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    if (objectMap(doc, id)) present.push(id);
  }
  return present;
}

/** Is this a usable, non-empty id-to-something map? (Cheap, and never throws.) */
function isNonEmptyMap(value: unknown): value is Map<string, unknown> {
  return (
    !!value &&
    typeof (value as Map<string, unknown>).size === 'number' &&
    typeof (value as Map<string, unknown>).get === 'function' &&
    typeof (value as Map<string, unknown>).entries === 'function' &&
    (value as Map<string, unknown>).size > 0
  );
}

/**
 * Write absolute top-left positions (`sel.group_move`, `sel.nudge`).
 *
 * Absolute rather than "add this delta to what is there now": a gesture that
 * accumulated a delta per frame would drift whenever somebody else moved the same
 * object mid-drag, and two screens would disagree. The last writer wins, and every
 * screen ends up where the last writer said.
 *
 * Any non-finite coordinate refuses the whole call — half a selection moving is
 * worse than none — and an id that is no longer on the board is skipped (a colleague
 * may delete one of them at any moment). One transaction, or none.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (!isNonEmptyMap(positions)) return 0;
  for (const point of positions.values()) {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return 0;
  }
  const ids = presentIds(doc, positions.keys());
  if (ids.length === 0) return 0;
  let applied = 0;
  doc.transact(() => {
    for (const id of ids) {
      const object = objectMap(doc, id);
      const point = positions.get(id);
      if (!object || !point) continue;
      object.set('x', point.x);
      object.set('y', point.y);
      applied += 1;
    }
  }, LOCAL_ORIGIN);
  return applied;
}

/**
 * Write absolute rects (`sel.resize`). Resizing an implicit-size note writes both
 * fields, which is the one way a note made before this story gains a size — no
 * migration, no board-wide rewrite.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (!isNonEmptyMap(rects)) return 0;
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
  const ids = presentIds(doc, rects.keys());
  if (ids.length === 0) return 0;
  let applied = 0;
  doc.transact(() => {
    for (const id of ids) {
      const object = objectMap(doc, id);
      const rect = rects.get(id);
      if (!object || !rect) continue;
      object.set('x', rect.x);
      object.set('y', rect.y);
      object.set('width', rect.width);
      object.set('height', rect.height);
      applied += 1;
    }
  }, LOCAL_ORIGIN);
  return applied;
}

/**
 * Put the selection above every object it does not contain, keeping the order the
 * selected objects had among themselves (`sel.group_move`).
 *
 * The reassignment is `highest unselected z + rank`, which needs one pass and gives
 * the same answer on every screen. Returns the number of objects whose `z` actually
 * changed, so a gesture that grabs what is already on top writes nothing.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const present = presentIds(doc, ids ?? []);
  if (present.length === 0) return 0;
  const selected = new Set(present);
  const entries: { id: string; object: ObjMap; z: number }[] = [];
  for (const id of present) {
    const object = objectMap(doc, id);
    if (!object) continue;
    const z = object.get('z');
    entries.push({ id, object, z: isFiniteNumber(z) ? (z as number) : 0 });
  }
  if (entries.length === 0) return 0;

  let top = 0;
  for (const [id, value] of objectsOf(doc)) {
    if (selected.has(id) || !(value instanceof Y.Map)) continue;
    const z = (value as ObjMap).get('z');
    if (isFiniteNumber(z) && (z as number) > top) top = z as number;
  }

  // The order they are drawn in today, which is the order they keep.
  entries.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : 1) : a.z - b.z));
  const changes = entries
    .map((entry, rank) => ({ entry, next: top + 1 + rank }))
    .filter(({ entry, next }) => entry.z !== next);
  if (changes.length === 0) return 0;

  doc.transact(() => {
    for (const { entry, next } of changes) entry.object.set('z', next);
  }, LOCAL_ORIGIN);
  return changes.length;
}

/**
 * Something to do the moment objects are deleted, before the transaction closes.
 *
 * An object of one type can refer to an object of another, and a delete must not leave the
 * reference dangling for anyone to see: an arrow tied to a shape that is going (`connector.model`)
 * has its end rewritten inside the same transaction, so there is never a state — not even a
 * transient one, not even for a client that syncs mid-drag — where an arrow points at nothing.
 * A type registers its hook when it is imported, the same way it declares itself readable.
 */
export type ObjectDeleteHook = (doc: Y.Doc, ids: readonly string[]) => void;

const deleteHooks: ObjectDeleteHook[] = [];

/** Say that deleting objects must also do this. See `ObjectDeleteHook`. */
export function onObjectsDeleted(hook: ObjectDeleteHook): void {
  if (typeof hook === 'function') deleteHooks.push(hook);
}

/**
 * Remove every object named (`sel.group_delete`). Ids that are already gone are
 * skipped, so a delete raced by a colleague who got there first is simply a smaller
 * change rather than an error.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = presentIds(doc, ids ?? []);
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Whoever referred to these objects is told first, while every object can still be
    // measured: a rewrite that has to guess where the thing it referred to was would be a
    // visible jump.
    for (const hook of deleteHooks) hook(doc, present);
    const objects = objectsOf(doc);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/** The note's shared text, or undefined when the id is not a sticky note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objectMap(doc, id);
  if (!object || object.get('type') !== STICKY_OBJECT_TYPE) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Read one object into an immutable snapshot, or null when this build cannot draw it.
 *
 * A type that has not been declared — because the story that owns it has not shipped,
 * or because a newer client wrote something this one has never heard of — returns null
 * rather than a half-read object, which is what keeps an unknown object out of every
 * list, selection and bounding box.
 */
/**
 * The parts every object has, or `null` when this build cannot draw this object at all.
 *
 * Split out of `readObject` because the position of one object can depend on the position of
 * another, and that is only knowable once every object has been looked at once.
 */
function readCommon(id: string, object: ObjMap): ObjectSnapshot | null {
  const type = object.get('type');
  if (typeof type !== 'string' || !isDeclaredObjectType(type)) return null;
  // Story 7: a note made before this story carries no size at all and is left without
  // the fields, so `objectBounds` can tell "never sized" from "sized to exactly 200".
  const width = isFiniteNumber(object.get('width')) ? (object.get('width') as number) : undefined;
  const height = isFiniteNumber(object.get('height')) ? (object.get('height') as number) : undefined;
  return {
    id,
    type,
    x: isFiniteNumber(object.get('x')) ? (object.get('x') as number) : 0,
    y: isFiniteNumber(object.get('y')) ? (object.get('y') as number) : 0,
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {})
  };
}

function readObject(
  object: ObjMap,
  common: ObjectSnapshot,
  context: SnapshotContext
): ObjectSnapshot | StickySnapshot | null {
  const type = common.type;
  // A type that owns its own reader uses it; a declared type without one is drawn
  // from the common fields alone.
  const reader = objectReaders.get(type);
  if (reader) return reader(object, common, context);
  if (type !== STICKY_OBJECT_TYPE) return common;

  const color = object.get('color');
  const text = object.get('text');
  const createdAt = object.get('createdAt');
  return {
    ...common,
    type: STICKY_OBJECT_TYPE as 'sticky',
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0
  };
}

/**
 * Immutable view of every object this build can draw, sorted by (z, id). `id` breaks
 * ties so two clients that sync equal `z` values still render the same order.
 */
export function boardObjects(doc: Y.Doc): ObjectSnapshot[] {
  // Two passes, and only because a type can take its bounds from other objects: read what
  // every object says about where it is, then read the objects themselves with the whole
  // board to hand.
  const entries: Array<{ object: ObjMap; common: ObjectSnapshot }> = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map)) continue;
    const common = readCommon(id, object as ObjMap);
    if (common) entries.push({ object: object as ObjMap, common });
  }
  const rects = new Map<string, Rect>();
  for (const entry of entries) rects.set(entry.common.id, objectBounds(entry.common));
  const context: SnapshotContext = { rects };

  const objects: ObjectSnapshot[] = [];
  for (const entry of entries) {
    const read = readObject(entry.object, entry.common, context);
    if (read) objects.push(read);
  }
  objects.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return objects;
}

/**
 * Where every object this build can draw is, by id — the same map a snapshot reader is
 * handed, for the code that is not reading a snapshot and still has to know where things are.
 *
 * An arrow asks this question of the board to work out the anchor its end should hold, and the
 * screen asks it to draw the line between two shapes it does not own.
 */
export function objectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of boardObjects(doc)) rects.set(object.id, objectBounds(object));
  return rects;
}

/**
 * Immutable view of every sticky note on the board: `boardObjects` narrowed to the one
 * type whose fields this note renderer needs.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return boardObjects(doc).filter((object): object is StickySnapshot => object.type === STICKY_OBJECT_TYPE);
}

/**
 * `crypto.randomUUID` with a fallback for environments without WebCrypto. Exported
 * because the code that owns another object type needs the same ids: a text object is
 * found in the same `objects` map by the same kind of key.
 */
export function createId(): string {
  const cryptoRef = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  const random = Math.random().toString(36).slice(2, 10);
  return `id-${Date.now().toString(36)}-${random}`;
}
