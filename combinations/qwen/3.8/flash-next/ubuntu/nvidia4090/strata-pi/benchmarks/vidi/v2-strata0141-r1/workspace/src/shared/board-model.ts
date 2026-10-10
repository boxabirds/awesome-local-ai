import * as Y from 'yjs';
import { rectContains, type Point, type Rect } from './geometry';
import { resolveEndpoints } from './geometry/connector-geometry';
import type { TextSnapshot } from './objects/text';
import type { ShapeSnapshot } from './objects/shape';
import type { ConnectorSnapshot } from './objects/connector';
import type { StrokeSnap } from './objects/stroke';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * The board document model (anchor `board.model`).
 *
 * Y.Doc schema - this is the format story 4 persists and story 3 syncs, so it
 * is versioned from day one:
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map> where each value is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * The module is framework-free (no React, no DOM) so the story 4 Durable Object
 * can import it for validation and migration. It never throws for user-driven
 * input: every rejection (stale id, unknown colour, non-finite coordinate,
 * pointless no-op) returns `false` before a transaction is opened, so no
 * `update` event is emitted.
 */

/** Schema version written to `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

/**
 * Transaction origin for every local mutation. Story 8 uses it for undo and
 * story 3 uses it to avoid echoing a change back to its author.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/**
 * Any board object, whatever type it is (anchor `sel.all_types`).
 *
 * `width`/`height` are optional: an object created before story 7 has no size
 * stored and renders at its type's default (`objectBounds`). The first resize
 * writes both fields.
 */
export interface ObjectSnapshot {
  readonly id: string;
  readonly type: string;
  /** Top-left corner, world units. */
  readonly x: number;
  readonly y: number;
  /** Stacking order; higher is drawn on top. */
  readonly z: number;
  readonly createdAt: number;
  /** Size in world units, when the object has an explicit one. */
  readonly width?: number;
  readonly height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  readonly type: 'sticky';
  readonly color: StickyColor;
  readonly text: string;
}

/** Is this snapshot a sticky note? */
export function isStickySnapshot(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

/** Is this snapshot a free text object (story 9)? */
export function isTextSnapshot(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === 'text';
}

/** Is this snapshot a shape - a rectangle, ellipse or diamond (story 10)? */
export function isShapeSnapshot(obj: ObjectSnapshot): obj is ShapeSnapshot {
  return obj.type === 'shape';
}

/** Is this snapshot an arrow - a connector between two objects (story 10)? */
export function isConnectorSnapshot(obj: ObjectSnapshot): obj is ConnectorSnapshot {
  return obj.type === 'connector';
}

/** Is this snapshot a freehand drawing - a pen stroke (story 11)? */
export function isStrokeSnapshot(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === 'stroke';
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(STICKY_COLORS, value) &&
  (STICKY_COLORS as Record<string, string>)[value] !== undefined;

const objectMapOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** WebCrypto when this environment has it. */
function webCrypto(): Crypto | undefined {
  return (globalThis as { crypto?: Crypto }).crypto;
}

/** Ids are UUIDs so concurrent clients cannot collide (story 3). */
function randomId(): string {
  const crypto = webCrypto();
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` currently in the document (0 when there are no objects). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

/** Apply the story 2 schema to a document (idempotent). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>('meta');
  if (meta.get('schemaVersion') === SCHEMA_VERSION) {
    return;
  }
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (world units), on top of everything
 * else. Returns the new id, or an empty string when the point or colour is
 * invalid (no id exists, and no transaction is opened).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) {
    return '';
  }
  if (!isStickyColor(color)) {
    return '';
  }
  const id = randomId();
  doc.transact(() => {
    const objects = objectMapOf(doc);
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    // Coordinates are the note's top-left, so the stored position is half a
    // note up and to the left of the point it is centred on.
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text(''));
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object to a new top-left position. `false` when stale or a no-op. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return false;
  }
  // The single-object case is the group case with one entry (Key decision 3),
  // so a drag and a group move cannot drift apart.
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/** Raise an object above every other one. `false` when stale or already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/** Change a sticky's colour. `false` for a stale id, unknown or unchanged colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) {
    return false;
  }
  const note = asObjectMap(objectMapOf(doc).get(id));
  if (!note || note.get('type') !== 'sticky') {
    return false;
  }
  if (note.get('color') === color) {
    return false;
  }
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. `false` when the id is stale. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's `Y.Text` (shared with story 3), or `undefined` for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = asObjectMap(objectMapOf(doc).get(id));
  if (!note || note.get('type') !== 'sticky') {
    return undefined;
  }
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

const stickyFrom = (id: string, value: unknown): StickySnapshot | undefined => {
  const note = asObjectMap(value);
  if (!note || note.get('type') !== 'sticky') {
    return undefined; // stories 9-12 add other types: skip them here
  }
  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  const createdAt = note.get('createdAt');
  const color = note.get('color');
  const text = note.get('text');
  const width = note.get('width');
  const height = note.get('height');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined; // a half-written object is not renderable
  }
  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    width: isFiniteNumber(width) ? width : undefined,
    height: isFiniteNumber(height) ? height : undefined,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  });
};

/**
 * Immutable render model: sticky notes only, ordered by `(z, id)` so every
 * client computes the same stacking even when concurrent edits produce equal
 * `z` values.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectMapOf(doc).forEach((value, id) => {
    const note = stickyFrom(id, value);
    if (note) {
      notes.push(note);
    }
  });
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

/* ===========================================================================
 * Story 7: one set of operations for every object type
 * (anchor `sel.geometry_ops`, `sel.all_types`).
 *
 * Selection, marquee, select-all, group move, group resize and group delete
 * are computed here so a new object type (stories 9-12) needs no new
 * interaction code: it only declares its minimum size.
 *
 * Which types the board knows is registered here (`registerSelectableType`)
 * by the client's object registry, so an object of a type no client can
 * render is never selected, moved or resized.
 * ======================================================================== */

const SELECTABLE_TYPES = new Set<string>(['sticky']);

/** Declare that `type` is an object type this board can select and transform. */
export function registerSelectableType(type: string): void {
  SELECTABLE_TYPES.add(type);
}

/** Is this object type one the board can select, move and resize? */
export function isSelectableType(type: string): boolean {
  return SELECTABLE_TYPES.has(type);
}

/**
 * Every object the board can show and select, ordered by `(z, id)`.
 *
 * Objects of a type nothing can render are skipped, exactly as `snapshot()`
 * skips them, so a board written by a newer client still opens.
 *
 * A type whose box is **derived** (story 10's connectors) gets its stored
 * `x`/`y`/`width`/`height` replaced here, by the box its own geometry reports
 * against the objects it refers to. Everything downstream - selection, marquee,
 * the selection box, hit tests - then reads one rectangle for every object, and
 * an arrow's box is always where the arrow actually is.
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const read: ObjectSnapshot[] = [];
  objectMapOf(doc).forEach((value, id) => {
    const obj = objectFrom(id, value);
    if (obj) {
      read.push(obj);
    }
  });

  // The stored boxes are read first: a derived render model is derived from them.
  const rects = new Map<string, Rect>();
  for (const obj of read) {
    if (!VIEW_DERIVERS.has(obj.type)) {
      rects.set(obj.id, objectBounds(obj));
    }
  }

  const objects: ObjectSnapshot[] = [];
  for (const obj of read) {
    const derive = VIEW_DERIVERS.get(obj.type);
    const derived = derive ? derive(obj, rects) : obj;
    if (!derived) {
      continue; // nothing to draw: an arrow that refers to nothing is skipped
    }
    objects.push(derived);
  }

  objects.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return objects;
}

/**
 * How one object type is read out of the document.
 *
 * A snapshot is more than a position: the component a type registers draws its
 * own fields - a sticky note's colour and text - so `objectSnapshots` hands each
 * entry to its type's reader. A registered type without a reader gets the plain
 * position snapshot, which is enough to select, move and resize it. Stories
 * 9-12 add a reader beside their own model functions.
 */
type SnapshotReader = (id: string, value: unknown) => ObjectSnapshot | undefined;

const SNAPSHOT_READERS = new Map<string, SnapshotReader>([['sticky', stickyFrom]]);

/** Declare how one object type's snapshot is read. */
export function registerSnapshotReader(type: string, read: SnapshotReader): void {
  SNAPSHOT_READERS.set(type, read);
}

/**
 * How one object type's **render model** is derived instead of stored
 * (`connector.follow`).
 *
 * A connector stores endpoints, not a position: its box is whatever its resolved
 * endpoints cover, and what an arrow is drawn to is decided against the objects
 * it refers to. `rects` holds the box of every other object read in the same
 * pass, so a deriver never reaches back into the document and every derived
 * value in one frame is computed against the same snapshot of the board.
 *
 * Returning `null` means "there is nothing to draw", and the object is skipped.
 */
export type ViewDeriver = (
  snapshot: ObjectSnapshot,
  rects: ReadonlyMap<string, Rect>,
) => ObjectSnapshot | null;

const VIEW_DERIVERS = new Map<string, ViewDeriver>();

/** Declare that this type's render model is derived from the objects it refers to. */
export function registerViewDeriver(type: string, derive: ViewDeriver): void {
  VIEW_DERIVERS.set(type, derive);
}

/** Does this type's box come from geometry rather than from its stored numbers? */
export function hasDerivedView(type: string): boolean {
  return VIEW_DERIVERS.has(type);
}

/** A snapshot of one stored object, or `undefined` if it cannot be drawn. */
function objectFrom(id: string, value: unknown): ObjectSnapshot | undefined {
  const entry = asObjectMap(value);
  if (!entry) {
    return undefined;
  }
  const type = entry.get('type');
  if (typeof type !== 'string' || !isSelectableType(type)) {
    return undefined;
  }
  const read = SNAPSHOT_READERS.get(type);
  if (read) {
    return read(id, value);
  }
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const width = entry.get('width');
  const height = entry.get('height');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined;
  }
  return Object.freeze({
    id,
    type,
    x,
    y,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    width: isFiniteNumber(width) ? width : undefined,
    height: isFiniteNumber(height) ? height : undefined,
  });
}

/**
 * The rectangle an object occupies, in world units.
 *
 * An object created before story 7 stores no size: it reads as
 * STICKY_SIZE_WORLD, the size it was drawn at all along (Key decision 5), so a
 * board written by an older client is selected and moved exactly where it is.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const x = isFiniteNumber(obj?.x) ? obj.x : 0;
  const y = isFiniteNumber(obj?.y) ? obj.y : 0;
  const width = isFiniteNumber(obj?.width) && obj.width > 0 ? obj.width : STICKY_SIZE_WORLD;
  const height = isFiniteNumber(obj?.height) && obj.height > 0 ? obj.height : STICKY_SIZE_WORLD;
  return { x, y, width, height };
}

/** Ids of the objects lying **entirely** inside `rect` (marquee selection). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  return selectionSnapshot(snapshot)
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/** Ids of every selectable object (select all). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return selectionSnapshot(snapshot).map((obj) => obj.id);
}

/**
 * Move objects to absolute positions (`sel.group_move`).
 *
 * Positions are absolute - `start + delta` from the beginning of the gesture,
 * never `current + this frame` (Key decision 1) - so two clients moving the
 * same object converge on the last writer instead of accumulating drift.
 *
 * Non-finite positions are refused, ids that no longer exist are skipped, and a
 * call that would change nothing opens no transaction at all.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (!positions || positions.size === 0) {
    return 0;
  }
  const objects = objectMapOf(doc);
  const writes: { entry: Y.Map<unknown>; x: number; y: number }[] = [];
  positions.forEach((position, id) => {
    if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
      return;
    }
    const entry = asObjectMap(objects.get(id));
    if (!entry) {
      return; // deleted elsewhere mid-gesture (TC-05)
    }
    if (hasDerivedView(typeOf(entry))) {
      return; // a connector's box is derived from its ends: it has no position of its own
    }
    if (entry.get('x') === position.x && entry.get('y') === position.y) {
      return; // already there: no update to broadcast
    }
    writes.push({ entry, x: position.x, y: position.y });
  });
  if (writes.length === 0) {
    return 0;
  }
  doc.transact(() => {
    for (const write of writes) {
      write.entry.set('x', write.x);
      write.entry.set('y', write.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Resize objects to absolute rects (`sel.resize`).
 *
 * This is where `width` and `height` become stored fields: an object that only
 * ever had an implied size gets both numbers written, on the first resize, and
 * every client - and every later object type - reads the same size back
 * (Key decision 5).
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (!rects || rects.size === 0) {
    return 0;
  }
  const objects = objectMapOf(doc);
  const writes: { entry: Y.Map<unknown>; rect: Rect }[] = [];
  rects.forEach((rect, id) => {
    if (
      !rect ||
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return;
    }
    const entry = asObjectMap(objects.get(id));
    if (!entry) {
      return;
    }
    if (hasDerivedView(typeOf(entry))) {
      return; // resizing a derived box would write numbers nothing reads back
    }
    if (
      entry.get('x') === rect.x &&
      entry.get('y') === rect.y &&
      entry.get('width') === rect.width &&
      entry.get('height') === rect.height
    ) {
      return;
    }
    writes.push({ entry, rect });
  });
  if (writes.length === 0) {
    return 0;
  }
  doc.transact(() => {
    for (const write of writes) {
      write.entry.set('x', write.rect.x);
      write.entry.set('y', write.rect.y);
      write.entry.set('width', write.rect.width);
      write.entry.set('height', write.rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Raise a group above everything unselected (`sel.stacking`, Key decision 4).
 *
 * The group keeps its internal order: the selected objects are sorted by their
 * current `z` and given `maxUnselectedZ + 1`, `+2`, ... A group that is already
 * sitting above everything it could overlap writes nothing at all.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectMapOf(doc);
  const selected = new Map<string, Y.Map<unknown>>();
  for (const id of ids ?? []) {
    const entry = asObjectMap(objects.get(id));
    if (entry) {
      selected.set(id, entry);
    }
  }
  if (selected.size === 0) {
    return 0;
  }

  let highestUnselected = 0;
  objects.forEach((value, id) => {
    if (selected.has(id)) {
      return;
    }
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highestUnselected) {
      highestUnselected = z;
    }
  });

  // Lowest first, so the group keeps the order it already had.
  const ordered = [...selected.entries()]
    .map(([id, entry]) => ({ id, entry, z: numberOr(entry.get('z'), 0) }))
    .sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const untouched = ordered.every(
    (item, index) =>
      item.z > highestUnselected && item.z === highestUnselected + index + 1,
  );
  if (untouched) {
    return 0;
  }

  const writes: { entry: Y.Map<unknown>; z: number }[] = [];
  ordered.forEach((item, index) => {
    const z = highestUnselected + index + 1;
    if (item.z !== z) {
      writes.push({ entry: item.entry, z });
    }
  });
  if (writes.length === 0) {
    return 0;
  }
  doc.transact(() => {
    for (const write of writes) {
      write.entry.set('z', write.z);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Delete a group (`sel.group_delete`). Ids that are already gone are skipped; a
 * call with nothing to delete opens no transaction.
 *
 * The arrows attached to the deleted objects are detached in the **same**
 * transaction (`connector.detach`, TC-13): one update, so no client ever sees a
 * connector attached to an object that no longer exists.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectMapOf(doc);
  const present = (ids ?? []).filter((id) => objects.has(id));
  if (present.length === 0) {
    return 0;
  }
  doc.transact(() => {
    // Before the objects go: detaching needs the rectangles they are still at.
    detachConnectorsTo(doc, present);
    for (const id of present) {
      objects.delete(id);
    }
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Turn the attached ends of `deletedIds` into free ends (`connector.detach`).
 *
 * Called inside an open transaction - `deleteObjects` above is the caller - and
 * writing nothing but the endpoints themselves: each attached end becomes a free
 * end at the anchor it was drawn to, so the arrow stays exactly where it was
 * when the object it pointed at disappeared (TC-13). An end attached to an
 * object that survives is left attached.
 *
 * Returns how many ends were detached.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): number {
  const deleted = new Set<string>((deletedIds ?? []).filter((id) => typeof id === 'string'));
  if (deleted.size === 0) {
    return 0;
  }
  const objects = objectMapOf(doc);
  const connectors: { entry: Y.Map<unknown>; snapshot: ConnectorSnapshot }[] = [];
  const rects = new Map<string, Rect>();

  objects.forEach((value, id) => {
    const snapshot = objectFrom(id, value);
    if (!snapshot) {
      return;
    }
    if (isConnectorSnapshot(snapshot)) {
      // Read as stored: the endpoints are what the detach decides on.
      connectors.push({ entry: value as Y.Map<unknown>, snapshot });
      return;
    }
    rects.set(id, objectBounds(snapshot));
  });

  const writes: { entry: Y.Map<unknown>; end: 'from' | 'to'; point: Point }[] = [];
  for (const { entry, snapshot } of connectors) {
    const resolved = resolveEndpoints(snapshot, rects);
    for (const end of ['from', 'to'] as const) {
      const endpoint = snapshot[end];
      if (endpoint.kind === 'attached' && deleted.has(endpoint.objectId)) {
        writes.push({ entry, end, point: resolved[end] });
      }
    }
  }
  if (writes.length === 0) {
    return 0;
  }
  // Inside an open transaction this joins it; on its own it is one update.
  doc.transact(() => {
    for (const write of writes) {
      write.entry.set(write.end, { kind: 'free', x: write.point.x, y: write.point.y });
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** The stored `type` of an entry, for the checks that are per type. */
const typeOf = (entry: Y.Map<unknown>): string => {
  const type = entry.get('type');
  return typeof type === 'string' ? type : '';
};

const numberOr = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? value : fallback;

/**
 * The snapshot entries a selection may contain: a type something can render, and
 * numbers a box can be built from. Unknown types stay unselectable (TC-08), so
 * they cannot be moved, resized or deleted - which is also why they are never
 * deleted by accident.
 */
function selectionSnapshot(snapshot: readonly ObjectSnapshot[]): readonly ObjectSnapshot[] {
  return (snapshot ?? []).filter(
    (obj) =>
      obj !== undefined &&
      isSelectableType(obj.type) &&
      isFiniteNumber(obj.x) &&
      isFiniteNumber(obj.y),
  );
}
