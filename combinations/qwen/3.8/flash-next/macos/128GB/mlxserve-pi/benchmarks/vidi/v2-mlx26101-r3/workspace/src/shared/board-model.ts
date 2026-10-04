import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  isTextSize,
  isTextWidthMode,
  type StickyColor,
  type TextSize,
  type TextWidthMode,
} from './config';
import { rectContains, unionRects, type Point, type Rect } from './geometry';

/**
 * The board document schema and every mutation of it.
 *
 * This module is framework-free on purpose: the client renders a snapshot of it today,
 * story 3 syncs the same document between peers and story 4 persists it (the Durable
 * Object imports this file to validate and migrate), so the shape below is the wire and
 * storage contract from the start.
 *
 * ```text
 * Y.Doc
 *   meta: Y.Map    { schemaVersion: 1 }
 *   objects: Y.Map<string /* id *\/, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left, world units
 *       width: number, height: number   // world units; absent before story 7
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking; higher is on top
 *       createdAt: number      // epoch ms
 *     }
 *     <id>: Y.Map {            // a text object (story 9), which has no colour and instead:
 *       type: 'text', size: TextSize, widthMode: 'auto' | 'fixed', createdBy: string
 *     }
 * ```
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`; a rejected
 * mutation (stale id, unknown colour, non-finite coordinates, pointless re-stack) returns
 * `false` before a transaction is opened, so it emits no update and will cost no sync
 * traffic in story 3. The module never throws for user-driven input.
 */

/** Origin of every local mutation; story 8 uses it for undo, story 3 to avoid echo. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Document schema version written by {@link initDoc}. */
export const SCHEMA_VERSION = 1;

/** Names of the top-level shared types of the document. */
export const META_MAP = 'meta';
export const OBJECTS_MAP = 'objects';

/** The `type` discriminator of a sticky note. Unknown values are skipped by the reader. */
export const STICKY_TYPE = 'sticky';

/**
 * The object types this client can read.
 *
 * `snapshot` only reads types listed here, so a document written by a newer client - one that
 * already has shapes or frames in it - is still readable: its objects are skipped instead of
 * breaking the board. The client's object registry ({@link registerObjectReader}) adds a type
 * here when it registers the component that draws it, which is what lets a type be added in one
 * place and have the model, the renderer and the selection maths agree about it.
 */
const readableTypes = new Set<string>([STICKY_TYPE]);

/**
 * Let the model read objects of `type`. Called once per type by the client's object registry;
 * idempotent, and never removes a type (a document may already hold objects of it).
 */
export function registerObjectReader(type: string): void {
  if (type !== '') {
    readableTypes.add(type);
  }
}

/** Whether {@link snapshot} reads objects of this `type`. */
export function canReadObjectType(type: unknown): boolean {
  return typeof type === 'string' && readableTypes.has(type);
}

/**
 * Any board object, as the board reads it: the geometry every object has, plus the fields of
 * whichever type it is. Sticky notes are the only type today, which is why the type-specific
 * fields are always present; stories 9-12 turn this into a union and add `text`, `shape`,
 * `draw` and `image` fields to it.
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  /**
   * Size in world units. An object made before story 7 stores no size and reads back as
   * {@link STICKY_SIZE_WORLD}, which is the size it was drawn at then.
   */
  readonly width: number;
  readonly height: number;
  readonly color: StickyColor;
  /** The object's text, read from its `Y.Text` ('' for an object that has none). */
  readonly text: string;
  readonly z: number;
  readonly createdAt: number;
  /**
   * How big the letters of a text object are (story 9). Only a type that has a size has one, so
   * it is absent for a sticky note - which is why it is optional here rather than a field every
   * object is asked to fill in.
   */
  readonly size?: TextSize;
  /** Whether a text object's width follows its longest line or the width it was given. */
  readonly widthMode?: TextWidthMode;
  /** Who made this object. There is no account system yet, so this is what the creating client
   * called itself; the board does not check it and nothing in the UI reads it. */
  readonly createdBy?: string;
}

/**
 * Story 2's name for a readable object. Sticky notes are the only object type there is today,
 * so a sticky's snapshot is any object's snapshot; code that only understands notes keeps
 * saying this.
 */
export type StickySnapshot = ObjectSnapshot;

/**
 * A free text object (story 9), as the board reads it.
 *
 * The two fields a text object has that no other type has are required here, because the reader
 * gives both of them a value: an object written before a field existed, or carrying a size from a
 * future version this client does not know, reads back as the default rather than as nothing. That
 * is what lets the drawing code say `object.size` instead of asking what size an unknown size
 * means, at every place it draws.
 */
export interface TextSnapshot extends ObjectSnapshot {
  readonly type: 'text';
  /** Which of the four sizes the letters are drawn at. */
  readonly size: TextSize;
  /** Whether the width follows the longest line, or the width the last drag gave it. */
  readonly widthMode: TextWidthMode;
  /** Who made it, when the creating client recorded that. Nothing checks it and nothing shows it. */
  readonly createdBy?: string;
}

/** Point in world units. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

/** True for one of the six colour names (runtime check: values arrive from the wire). */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** A member of `objects` that this version of the client knows how to read. */
function readableObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = objects.get(id);
  if (object === undefined || !(object instanceof Y.Map) || !canReadObjectType(object.get('type'))) {
    return null;
  }
  return object;
}

/** A member of `objects` that is a sticky note this client can read. */
function stickyObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = readableObject(objects, id);
  return object !== null && object.get('type') === STICKY_TYPE ? object : null;
}

function readZ(object: YObject): number {
  const z = object.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/** Highest stacking order of any readable object; 0 for an empty document. */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map && canReadObjectType(object.get('type'))) {
      max = Math.max(max, readZ(object));
    }
  }
  return max;
}

/**
 * Ids are `crypto.randomUUID()`, so notes created offline by different peers (story 3)
 * never collide. The fallback only runs where the Web Crypto UUID helper is missing.
 */
function newId(): string {
  // `crypto` is a global in the browser and in the Worker; read it as one, not as a property
  // of `globalThis`, which only the browser's type library puts there.
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/**
 * Prepare a document for use, recording the schema version once. An existing version -
 * including one written by a newer client - is left alone, so loading a stored document
 * never rewrites its metadata.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_MAP);
  if (typeof meta.get('schemaVersion') === 'number') {
    return;
  }
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on `at` (the stored `x`/`y` are the top-left, hence the
 * half-size offset) and on top of every existing note.
 *
 * @returns the new id, or `''` when the point or colour was rejected.
 */
export function createSticky(
  doc: Y.Doc,
  at: WorldPoint,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at.x, at.y) || !isStickyColor(color)) {
    return '';
  }
  const id = newId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', STICKY_TYPE);
    object.set('x', at.x - STICKY_SIZE_WORLD / 2);
    object.set('y', at.y - STICKY_SIZE_WORLD / 2);
    object.set('color', color);
    object.set('text', new Y.Text());
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note to a new top-left, in world units. Moving a note onto the position it
 * already has is a no-op (`false`), which keeps drag frames from emitting updates.
 *
 * A single move in terms of {@link moveObjects}, so that moving one object and moving a
 * selection go through the same code and behave the same way.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Move a set of objects, each to its own new top-left, in world units.
 *
 * This is what a group drag writes: one transaction for the whole selection, so 200 selected
 * objects move as one change and one undo (story 8) puts them all back. An id that is not in
 * the document any more - a peer deleted it mid-drag - is skipped rather than recreated, and a
 * position that is not finite rejects the whole call: half a group moving to nowhere is worse
 * than none of it moving.
 *
 * @returns how many objects actually moved (0 when none of them needed to)
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const objects = objectsOf(doc);
  const targets: { object: YObject; x: number; y: number }[] = [];
  for (const [id, point] of positions) {
    const object = readableObject(objects, id);
    if (object === null) {
      continue;
    }
    if (!isFinitePoint(point.x, point.y)) {
      return 0;
    }
    if (object.get('x') === point.x && object.get('y') === point.y) {
      continue;
    }
    targets.push({ object, x: point.x, y: point.y });
  }
  if (targets.length === 0) {
    return 0;
  }
  doc.transact(() => {
    for (const target of targets) {
      target.object.set('x', target.x);
      target.object.set('y', target.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Resize and reposition a set of objects at once, from the boxes a group resize produced.
 *
 * One transaction, skipped ids, and the same rejection of non-finite geometry as
 * {@link moveObjects}; the caller has already scaled and clamped the boxes, so nothing here
 * knows about handles, aspect ratios or minimum sizes.
 *
 * @returns how many objects actually changed
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const objects = objectsOf(doc);
  const targets: { object: YObject; rect: Rect }[] = [];
  for (const [id, rect] of rects) {
    const object = readableObject(objects, id);
    if (object === null) {
      continue;
    }
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return 0;
    }
    if (
      object.get('x') === rect.x &&
      object.get('y') === rect.y &&
      object.get('width') === rect.width &&
      object.get('height') === rect.height
    ) {
      continue;
    }
    targets.push({ object, rect });
  }
  if (targets.length === 0) {
    return 0;
  }
  doc.transact(() => {
    for (const target of targets) {
      target.object.set('x', target.rect.x);
      target.object.set('y', target.rect.y);
      target.object.set('width', target.rect.width);
      target.object.set('height', target.rect.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Stack the given objects above every other object, keeping their order among themselves.
 *
 * The whole selection goes to the front in one transaction. The new `z` values are handed out
 * from the highest `z` of the objects that stayed behind, in the order the objects are already
 * drawn in, so a selection of three does not land as three equal values - which is what keeps
 * the notes the person picked in the order they were in, instead of shuffling them into an
 * arbitrary one. Already-on-top objects keep their place and cost no update.
 *
 * @returns how many objects changed
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const selected = new Set(ids);
  const moving: { id: string; object: YObject; z: number }[] = [];
  let top = 0;
  for (const [id, object] of objects.entries()) {
    if (!(object instanceof Y.Map) || !canReadObjectType(object.get('type'))) {
      continue;
    }
    const z = readZ(object);
    if (selected.has(id)) {
      moving.push({ id, object, z });
    } else {
      top = Math.max(top, z);
    }
  }
  if (moving.length === 0) {
    return 0;
  }
  // The order the board draws them in, so the front-to-back order of the selection is kept.
  moving.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // An object that is already higher than its new place is left where it is: bringing a
  // selection to the front never pushes part of it backwards.
  const target = moving.map((entry, index) => Math.max(entry.z, top + index + 1));
  const changed = moving.filter((entry, index) => target[index] !== entry.z).length;
  if (changed === 0) {
    return 0;
  }
  doc.transact(() => {
    moving.forEach((entry, index) => {
      const z = target[index];
      if (z !== undefined && z !== entry.z) {
        entry.object.set('z', z);
      }
    });
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Stack a note above every other one. Returns `false` when it is already on top, so a
 * drag that grabs the top note costs no update.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Change a note's colour, leaving text, position, stacking and creation time untouched.
 * Unknown colour names and stale ids are rejected.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) {
    return false;
  }
  const object = stickyObject(objectsOf(doc), id);
  if (object === null || object.get('color') === color) {
    return false;
  }
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Remove one object (and with it its `Y.Text`). A stale id is rejected.
 *
 * A single delete in terms of {@link deleteObjects}.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/**
 * Delete a set of objects in one transaction: what the Delete key and the selection bar's
 * Delete button do to a multi-selection.
 *
 * Ids that are not in the document any more are skipped - a peer got there first, the group is
 * still deleted - so a selection that went stale mid-action never brings an object back.
 *
 * @returns how many objects were deleted
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsOf(doc);
  const present = new Set<string>();
  for (const id of ids) {
    if (readableObject(objects, id) !== null) {
      present.add(id);
    }
  }
  if (present.size === 0) {
    return 0;
  }
  doc.transact(() => {
    for (const id of present) {
      objects.delete(id);
    }
  }, LOCAL_ORIGIN);
  return present.size;
}

/**
 * The object's text as a `Y.Text`, so typing merges character-wise with other peers
 * (story 3) instead of overwriting them. `undefined` for a stale or unreadable object.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = readableObject(objectsOf(doc), id);
  const text = object?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** A positive stored size, or the size every object was before story 7 let them be resized. */
function readSize(object: YObject, key: string): number {
  const size = object.get(key);
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : STICKY_SIZE_WORLD;
}

/**
 * Read one object, or `null` when a peer wrote something this client cannot render.
 *
 * A sticky note is only readable with a colour and a `Y.Text` of its own, because a note without
 * either could not be drawn. Other readable types are held to their geometry alone: an object of
 * a type a later story adds that has no text of its own is not malformed. What is held to the same
 * rule wherever it comes from is a text that is not a `Y.Text`: an object whose text is a plain
 * string cannot be typed into or merged with, so an object that has a `text` field of the wrong
 * kind is skipped rather than drawn with somebody else's idea of a string in it.
 *
 * The fields no other type has - `size`, `widthMode` - are read the same generic way, because the
 * object type modules cannot be imported here without a cycle (they read the model to be written
 * at all): a value that is not one of the named settings is left out, and the type's own reader
 * falls back to its default.
 */
function readObject(id: string, object: YObject): ObjectSnapshot | null {
  const type = object.get('type');
  const x = object.get('x');
  const y = object.get('y');
  const color = object.get('color');
  const text = object.get('text');
  const z = object.get('z');
  const createdAt = object.get('createdAt');
  const size = object.get('size');
  const widthMode = object.get('widthMode');
  const createdBy = object.get('createdBy');
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    typeof z !== 'number' ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  if (type === STICKY_TYPE) {
    if (!isStickyColor(color) || !(text instanceof Y.Text)) {
      return null;
    }
  } else if (text !== undefined && !(text instanceof Y.Text)) {
    return null;
  }
  return {
    id,
    type: typeof type === 'string' ? type : STICKY_TYPE,
    x,
    y,
    width: readSize(object, 'width'),
    height: readSize(object, 'height'),
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    ...(isTextSize(size) ? { size } : {}),
    ...(isTextWidthMode(widthMode) ? { widthMode } : {}),
    ...(typeof createdBy === 'string' && createdBy !== '' ? { createdBy } : {}),
  };
}

/**
 * Render order: objects sorted by `(z, id)`. The id tie-break matters as soon as two peers
 * stack at the same time (story 3): equal `z` values still give every client the same
 * order. Objects of unknown `type` - the shapes and frames of later stories - and
 * malformed notes are skipped rather than thrown on.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  for (const [id, object] of objectsOf(doc).entries()) {
    if (!(object instanceof Y.Map) || !canReadObjectType(object.get('type'))) {
      continue;
    }
    const read = readObject(id, object);
    if (read !== null) {
      objects.push(read);
    }
  }
  objects.sort(compareNotes);
  return objects;
}

function compareNotes(a: ObjectSnapshot, b: ObjectSnapshot): number {
  if (a.z !== b.z) {
    return a.z - b.z;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The box an object takes up on the board, in world units. Every object type has one, which is
 * what the marquee, the selection outline, the bounding box and the resize maths all work on.
 */
export function objectBounds(object: ObjectSnapshot): Rect {
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/**
 * Which objects the marquee box selects: the ones it contains *completely*, in the order the
 * board draws them.
 *
 * The PRD says an object "is selected only if it lies completely within the rectangle", so this
 * is containment and not intersection - the difference a test can only see at the edge, which is
 * why it is stated here rather than left to be inferred.
 */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return [];
  }
  return objects.filter((object) => rectContains(rect, objectBounds(object))).map((object) => object.id);
}

/** Every object the board holds and this client can draw, in draw order. `Ctrl/Cmd + A` selects them. */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.map((object) => object.id);
}

/**
 * The smallest box that holds a whole selection, or `null` when there is nothing to draw a box
 * around. The selection bar and the resize handles are placed from this.
 */
export function selectionBounds(objects: readonly ObjectSnapshot[], ids: Iterable<string>): Rect | null {
  const wanted = new Set(ids);
  return unionRects(
    objects.filter((object) => wanted.has(object.id)).map((object) => objectBounds(object)),
  );
}
