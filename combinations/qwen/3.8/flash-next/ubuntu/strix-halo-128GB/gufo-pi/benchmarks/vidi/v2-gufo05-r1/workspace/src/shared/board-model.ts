/**
 * The board document: a Yjs schema plus every mutation the app performs.
 *
 * Notes live in a `Y.Doc` from the first story that puts anything on the board,
 * so story 3 only has to attach a network provider and story 4 only has to
 * persist this same document. The module is framework-free (no React, no DOM)
 * so the Durable Object can import it unchanged.
 *
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map>
 *     <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *     <id>: Y.Map { type: 'image', x, y, width, height, z, createdAt,
 *                   assetKey, contentType, naturalWidth, naturalHeight,
 *                   status, uploadStartedAt, uploaderId }   // story 12
 * ```
 *
 * An image is the one type whose bytes are not in the document: it holds an `assetKey`
 * naming a stored picture, and `status` says whether those bytes have arrived
 * (`objects/image`).
 *
 * `x, y` is the note's top-left in world units; `z` is stacking order (higher is
 * on top) and `snapshot` sorts by `(z, id)` so clients that merge concurrent
 * equal `z` values still agree on the order.
 *
 * Errors are values, never exceptions: a stale id, an unknown colour name or a
 * non-finite coordinate makes the call return "no change" (`false`, or `''` for
 * `createSticky`) without opening a transaction, so nothing is synced or
 * persisted for a mutation that did not happen.
 */
import * as Y from 'yjs';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { snapshotFrom as readText, TEXT_TYPE } from './objects/text';
import {
  CONNECTOR_TYPE,
  connectorSnapshotFrom,
  detachConnectorsTo,
  resolveConnector,
  type ConnectorSnapshot,
} from './objects/connector';
import { IMAGE_TYPE, snapshotFrom as readImage } from './objects/image';
import { SHAPE_TYPE, snapshotFrom as readShape } from './objects/shape';
import { STROKE_TYPE, snapshotFrom as readStroke } from './objects/stroke';
import { rectContains, isFiniteRect, type Point, type Rect } from './geometry';

/**
 * Origin of every transaction this module opens. Story 8 uses it to scope undo
 * to local changes and story 3 to avoid echoing changes back over the wire.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Document layout keys, part of the persisted and wire format. */
export const META_KEY = 'meta';
export const OBJECTS_KEY = 'objects';
export const SCHEMA_VERSION = 1;

/** The only object type this story knows; stories 9-12 add the rest. */
export const STICKY_TYPE = 'sticky';

/**
 * An immutable view of one board object, whatever kind it is.
 *
 * The fields every object has for the board's generic behaviour (story 7):
 * a position, a size, a stacking order and a creation time. `width` and `height`
 * are read with the type's default size as the fallback, so an object created
 * before sizes were persisted still has a rectangle, and the first resize writes
 * both fields (`sel.geometry_ops`).
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly createdAt: number;
}

/** An immutable view of one sticky note, as React renders it. */
export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
}

const AN_EPOCH = 0;

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY) as Y.Map<unknown>;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>;
}

export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

/** A point the board can place a note at. */
function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/** The `Y.Map` for a sticky note, or `undefined` for a stale/foreign id. */
function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== STICKY_TYPE) return undefined;
  return map;
}

function noteText(map: Y.Map<unknown>): Y.Text {
  const existing = map.get('text');
  return existing instanceof Y.Text ? existing : new Y.Text();
}

/** A stored size, or the type's default when the object was made before sizes were kept. */
function storedSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readSticky(id: string, map: Y.Map<unknown>): StickySnapshot | null {
  if (map.get('type') !== STICKY_TYPE) return null; // stories 9-12 add types
  const x = map.get('x');
  const y = map.get('y');
  const z = map.get('z');
  const createdAt = map.get('createdAt');
  const color = map.get('color');
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    // A note created before story 7 has no `width`/`height` and draws at the
    // default square size until the first resize writes both fields.
    width: storedSize(map.get('width'), STICKY_SIZE_WORLD),
    height: storedSize(map.get('height'), STICKY_SIZE_WORLD),
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: noteText(map).toString(),
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : AN_EPOCH,
  };
}

/** Stacking order: `z` ascending, ids breaking ties so all clients agree. */
function compareStack(left: ObjectSnapshot, right: ObjectSnapshot): number {
  if (left.z !== right.z) return left.z - right.z;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/**
 * One snapshot per object the document describes, whatever its type.
 *
 * An object is readable when it says what it is and has a finite position and
 * stacking order. A type this build cannot draw still comes back as a plain
 * `ObjectSnapshot` — the client decides what to do with it by looking the type up
 * in its registry, which is where that knowledge lives (`sel.registry`).
 */
function readObject(id: string, map: Y.Map<unknown>): ObjectSnapshot | null {
  const type = map.get('type');
  if (typeof type !== 'string') return null;
  const x = map.get('x');
  const y = map.get('y');
  const z = map.get('z');
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  // Text carries its own box and font size, so it reads itself (`text.model`).
  if (type === IMAGE_TYPE) return readImage(id, map);
  if (type === TEXT_TYPE) return readText(id, map);
  if (type === SHAPE_TYPE) return readShape(id, map);
  // A connector's box is derived from the objects it is attached to; `objectSnapshots`
  // reads those with every other rectangle in hand. Read alone here, it gets a placeholder
  // box from its endpoints' own reference points.
  if (type === CONNECTOR_TYPE) return connectorSnapshotFrom(id, map);
  if (type === STROKE_TYPE) return readStroke(id, map);
  if (type === STICKY_TYPE) return readSticky(id, map);

  const createdAt = map.get('createdAt');
  return {
    id,
    type,
    x,
    y,
    width: storedSize(map.get('width'), STICKY_SIZE_WORLD),
    height: storedSize(map.get('height'), STICKY_SIZE_WORLD),
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : AN_EPOCH,
  };
}

/** Create the `meta` and `objects` containers if they are not there yet. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (typeof meta.get('schemaVersion') === 'number') return; // already initialised
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on `at` (world units), on top of every other note.
 * Returns the new id, or `''` when the coordinates are not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFinitePoint(at.x, at.y) || !isStickyColor(color)) return '';

  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', STICKY_TYPE);
    map.set('x', at.x - STICKY_SIZE_WORLD / 2);
    map.set('y', at.y - STICKY_SIZE_WORLD / 2);
    map.set('color', color);
    map.set('text', new Y.Text());
    map.set('z', z);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Largest `z` among the known objects, or 0 for an empty board. */
export function highestZ(doc: Y.Doc): number {
  let highest = 0;
  for (const map of objectsMap(doc).values()) {
    const z = map.get('z');
    if (typeof z === 'number' && z > highest) highest = z;
  }
  return highest;
}

/** Move a note to a new top-left. `false` for stale ids or non-finite input. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** Raise a note above every other note. `false` when it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

/** Set a note's colour. `false` for stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const map = stickyMap(doc, id);
  if (!map || !isStickyColor(color)) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note. `false` for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** The note's `Y.Text`, or `undefined` when the id is stale or not a note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = stickyMap(doc, id);
  if (!map) return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Every object on the board, of every type the document describes, sorted by
 * `(z, id)` — the order they are drawn in.
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  // Connectors are read second: an attached end is anchored against the *current* rectangle
  // of the object it follows, so every other object has to be read into a rectangle first
  // (`connector.follow`).
  const rects = new Map<string, Rect>();
  const connectors: ConnectorSnapshot[] = [];
  for (const [id, map] of objectsMap(doc)) {
    if (map.get('type') === CONNECTOR_TYPE) {
      const connector = connectorSnapshotFrom(id, map);
      if (connector) connectors.push(connector);
      continue;
    }
    const obj = readObject(id, map);
    if (!obj) continue;
    objects.push(obj);
    rects.set(id, objectBounds(obj));
  }
  for (const connector of connectors) objects.push(resolveConnector(connector, rects));
  objects.sort(compareStack);
  return Object.freeze(objects);
}

/**
 * Every known note, sorted by `(z, id)`.
 *
 * `objectSnapshots` narrowed to the one type this build draws, kept because the
 * note-specific code (colour swatches, text) wants a `StickySnapshot`. A type is
 * only selectable once the client has a component for it, which is why the client
 * filters `objectSnapshots` through its registry instead of using this list.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return Object.freeze(
    objectSnapshots(doc).filter((obj): obj is StickySnapshot => obj.type === STICKY_TYPE),
  );
}

/*
 * Generic object operations (story 7).
 *
 * Selection, marquee, group move, group resize, nudge and group delete are the
 * same for every kind of board object, so they live here rather than in whichever
 * component happens to draw one. Each mutating call either rejects the input and
 * writes nothing, or makes exactly one `LOCAL_ORIGIN` transaction and returns how
 * many objects it changed — the count the caller checks, never an exception.
 */

/**
 * The `Y.Map` a generic operation may write to: anything in `objects` that says
 * what it is. Selection only ever offers ids that came out of `snapshot`, so this
 * is a guard against a stale or hand-written entry rather than a type check — a
 * type that this build cannot draw has no business being moved by a gesture, and
 * a future object type is movable the moment it is drawn.
 */
function writableMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || typeof map.get('type') !== 'string') return undefined;
  return map;
}

/** The rectangle an object occupies, in world units. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/**
 * Ids of the objects lying entirely inside `rect`, in snapshot order.
 *
 * This is the marquee's containment rule (`sel.marquee`): an object the rectangle
 * only touches, or covers half of, is not selected.
 */
export function objectsInRect(
  objects: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  if (!isFiniteRect(rect)) return [];
  return objects.filter((obj) => rectContains(rect, objectBounds(obj))).map((obj) => obj.id);
}

/**
 * Every id a selection may hold, in snapshot order (select-all, `sel.all`).
 *
 * The snapshot is already restricted to the object types this build knows, so a
 * type it cannot draw — one written by a newer client — is not selectable here.
 */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.map((obj) => obj.id);
}

/**
 * Move objects to absolute top-left positions.
 *
 * Absolute rather than incremental: a gesture that added up per-frame deltas would
 * disagree with a remote person moving the same object, and every screen would
 * settle somewhere different. Missing ids are skipped.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;

  const targets: (readonly [Y.Map<unknown>, Point])[] = [];
  for (const [id, at] of positions) {
    // One position that is not a number rejects the whole call: a half-applied
    // frame would leave the selection with one object somewhere else.
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return 0;
    const map = writableMap(doc, id);
    if (map) targets.push([map, at]);
  }
  if (targets.length === 0) return 0;

  doc.transact(() => {
    for (const [map, at] of targets) {
      map.set('x', at.x);
      map.set('y', at.y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * The ids a move gesture may actually translate.
 *
 * Only notes, shapes and images have a position of their own. A piece of text re-lays itself
 * out from its words, and a connector's box is *derived* from the objects it is attached to,
 * so translating either would be meaningless — dragging a selection moves the shapes and
 * the arrows follow them (`connector.follow`). A transform gesture filters its ids through
 * this so a connector in the selection set never gets an `x`/`y` written.
 *
 * An image that has not finished uploading is movable with the rest: the placeholder has the
 * rectangle the picture will fill, and a person who drops three files and immediately drags
 * them somewhere is not doing anything wrong (`image.move`).
 */
export function moveableIds(doc: Y.Doc, ids: readonly string[]): string[] {
  const objects = objectsMap(doc);
  return ids.filter((id) => {
    const type = objects.get(id)?.get('type');
    return type === STICKY_TYPE || type === SHAPE_TYPE || type === IMAGE_TYPE;
  });
}

/** Write a new rectangle for each id, making an implicit size explicit. */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;

  const targets: (readonly [Y.Map<unknown>, Rect])[] = [];
  for (const [id, rect] of rects) {
    // A box with no size, or with a corner that is not a number, is not a resize.
    if (!isFiniteRect(rect) || rect.width <= 0 || rect.height <= 0) return 0;
    const map = writableMap(doc, id);
    if (map) targets.push([map, rect]);
  }
  if (targets.length === 0) return 0;

  doc.transact(() => {
    for (const [map, rect] of targets) {
      map.set('x', rect.x);
      map.set('y', rect.y);
      // Writing both fields is what turns a note that predates story 7 into one
      // with a size of its own; there is no migration step.
      map.set('width', rect.width);
      map.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

/**
 * Raise a set of objects above every object that is not in it, keeping their
 * relative stacking order.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const wanted = new Set(ids);
  const objects = objectSnapshots(doc);
  // `objectSnapshots` is in stacking order, so filtering it keeps the selected
  // objects' order among themselves for free.
  const selected = objects.filter((obj) => wanted.has(obj.id));
  if (selected.length === 0) return 0;

  let base = 0;
  for (const obj of objects) {
    if (!wanted.has(obj.id) && obj.z > base) base = obj.z;
  }

  // Rank from the top of the unselected pile, in the order they are drawn: the
  // selection ends up above everything else without shuffling itself.
  const changes = selected
    .map((obj, rank) => ({ id: obj.id, z: base + rank + 1, was: obj.z }))
    .filter(({ z, was }) => z !== was);
  if (changes.length === 0) return 0;

  doc.transact(() => {
    for (const { id, z } of changes) {
      objectsMap(doc).get(id)?.set('z', z);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Remove every id that exists. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = objectsMap(doc);
  const present = [...new Set(ids)].filter((id) => objects.has(id));
  if (present.length === 0) return 0;

  doc.transact(() => {
    // Free every arrow end attached to something about to go, while those objects are still
    // here to anchor it, in this same transaction: the delete and the detach are one update
    // and one undo step (`connector.target_deleted`).
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
