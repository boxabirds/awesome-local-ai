import * as Y from 'yjs';

import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_SIZES,
  type StickyColor,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import {
  connectorSnapshotOf,
  deriveConnectorBox,
  detachConnectorsTo,
  type ConnectorSnapshot,
} from './objects/connector';
import { shapeSnapshotOf, type ShapeSnapshot } from './objects/shape';

/**
 * The board document model: the Yjs schema and every mutation. Framework-free
 * so the client (now) and the Durable Object (story 4) share one
 * implementation, and so the same document can be synced (story 3) and
 * persisted (story 4) without users losing notes.
 *
 * Schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 */

/** Transaction origin for local, user-driven changes (undo in story 8). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Current document schema version; migrations key off this (story 4). */
const SCHEMA_VERSION = 1;

const META_MAP = 'meta';
const OBJECTS_MAP = 'objects';

/**
 * The fields every board object carries, whatever it is. Stories 9–12 add
 * types (text, shapes, drawings, images); they all share these, and story 7's
 * selection, move, resize and delete code only ever reads them.
 *
 * `width`/`height` arrived in story 7 and are optional: a note created before
 * it has none and is read at STICKY_SIZE_WORLD (`objectBounds`).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  createdAt: number;
  /**
   * Who made the object, when the type records it (story 9's text objects).
   * Presence and export read it; nothing on the board changes because of it.
   */
  createdBy?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(META_MAP);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

/** Write `x`/`y` only when both are finite (guards every position mutation). */
function finitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

/**
 * Idempotently stamp the schema version. Called once when a document is opened
 * (client and, later, the Durable Object). A no-op when already present.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/** Highest stacking number currently in use across all objects. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsMap(doc).values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Create a sticky note centred on `at` (top-left = at − size/2), on top of
 * every other note (z = maxZ + 1). Returns the new id, or '' when the point is
 * not finite (nothing is written and no update is emitted).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finitePoint(at.x, at.y)) return '';
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', Date.now());
    objectsMap(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note to world (x, y). Rejected for a stale id or non-finite input. This
 * is `moveObjects` for one id — the rules live there.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

/** Raise a note above every other note. Rejected when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  const z = entry.get('z');
  const target = maxZ(doc);
  if (typeof z === 'number' && z >= target) return false; // already topmost
  doc.transact(() => {
    entry.set('z', target + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejected for a stale id or an unknown colour. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const entry = objectsMap(doc).get(id);
  if (!entry) return false;
  if (entry.get('color') === color) return false; // no-op: no change applied
  doc.transact(() => {
    entry.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Remove a note. Rejected (false, no update) for a stale id. This is
 * `deleteObjects` for one id.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

/** The note's shared text, or undefined for a stale / non-sticky id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry) return undefined;
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The stacking order every snapshot uses: z first, id to break a tie. */
function byZThenId(a: { z: number; id: string }, b: { z: number; id: string }): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A number is a writable board coordinate when it is finite. */
function isCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * An immutable view of every object on the board, sorted by (z, id) so equal z
 * values (possible once story 3 syncs) still give every client the same order.
 * An object of a type this model does not know is reported with the common
 * fields only, so a newer client's shapes never break this one.
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  const connectors: ConnectorSnapshot[] = [];
  for (const [id, entry] of objectsMap(doc)) {
    const object = readSnapshot(entry, id);
    if (!object) continue;
    // An arrow's box is wherever the objects it joins currently are, so it is filled
    // in once every other box is known — the same pass for every reader, which is why
    // two boards draw one arrow from one document identically.
    if (isConnectorSnapshot(object)) connectors.push(object);
    else objects.push(object);
  }
  if (connectors.length > 0) {
    const rects = rectIndex(objects);
    for (const connector of connectors) objects.push(deriveConnectorBox(connector, rects));
  }
  objects.sort(byZThenId);
  return objects;
}

/** The box of every object that owns one, by id. */
function rectIndex(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objects) {
    if (object.type === 'connector') continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/**
 * The same view of one object, without walking the board. Text objects are
 * measured after every keystroke, and measuring one heading should not cost a
 * read of every object on it.
 */
export function objectSnapshot(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  const entry = objectsMap(doc).get(id);
  if (!entry) return undefined;
  const object = readSnapshot(entry, id);
  if (!object) return undefined;
  // An arrow read on its own still needs the boxes of the objects it joins.
  if (!isConnectorSnapshot(object)) return object;
  return deriveConnectorBox(object, rectIndex(objectSnapshots(doc)));
}

/** One entry of the objects map, or null when it carries no usable type. */
function readSnapshot(entry: Y.Map<unknown>, id: string): ObjectSnapshot | null {
  {
    const type = entry.get('type');
    if (typeof type !== 'string') return null; // unreadable: not on the board
    const base: Record<string, unknown> = {
      id,
      type,
      x: numberOr(entry.get('x'), 0),
      y: numberOr(entry.get('y'), 0),
      z: numberOr(entry.get('z'), 0),
      createdAt: numberOr(entry.get('createdAt'), 0),
    };
    // Story 7: notes made before it carry no size and are read at the default.
    const width = finiteNumber(entry.get('width'));
    if (width !== undefined) base.width = width;
    const height = finiteNumber(entry.get('height'));
    if (height !== undefined) base.height = height;
    const createdBy = entry.get('createdBy');
    if (typeof createdBy === 'string') base.createdBy = createdBy;
    if (type === 'text') {
      // Story 9: plain text, its size preset and how its width is decided.
      const text = entry.get('text');
      base.text = text instanceof Y.Text ? text.toString() : '';
      const size = entry.get('size');
      base.size =
        typeof size === 'string' && Object.hasOwn(TEXT_SIZES, size)
          ? size
          : DEFAULT_TEXT_SIZE;
      base.widthMode = entry.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
    }
    if (type === 'sticky') {
      const color = entry.get('color');
      const text = entry.get('text');
      base.color = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
      base.text = text instanceof Y.Text ? text.toString() : '';
    }
    // Story 10: a shape and an arrow each hold fields the common record cannot
    // express — an arrow's box is not stored at all — so each reads itself.
    if (type === 'shape') return shapeSnapshotOf(id, entry);
    if (type === 'connector') return connectorSnapshotOf(id, entry);
    return base as unknown as ObjectSnapshot;
  }
}

/**
 * Narrow a snapshot read from the board back to a sticky note. The registry hands
 * every component the common shape, so a component that draws a type's own fields
 * says so once, with this, instead of casting.
 */
export function isConnectorSnapshot(obj: ObjectSnapshot): obj is ConnectorSnapshot {
  return obj.type === 'connector';
}

/** Narrow a snapshot back to a shape (story 10). */
export function isShapeSnapshot(obj: ObjectSnapshot): obj is ShapeSnapshot {
  return obj.type === 'shape';
}

export function isStickySnapshot(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

/**
 * An immutable view of every sticky note, sorted by (z, id). Objects of unknown
 * `type` are skipped for forward compatibility (stories 9–12); use
 * `objectSnapshots` for the whole board.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objectSnapshots(doc).filter((obj): obj is StickySnapshot => obj.type === 'sticky');
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/* ------------------------------------------------------------------ * *
 * Story 7: every object, and generic group operations                   *
 * ------------------------------------------------------------------ */

/**
 * The object types this model can read into a full snapshot, and so may select by
 * itself. The client decides with its object type registry instead (design key
 * decision 5); this copy exists only so the shared model works without client
 * code (see `allObjectIds`'s predicate).
 */
const MODEL_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'sticky',
  'text',
  'shape',
  'connector',
]);

export function isKnownObjectType(type: string): boolean {
  return MODEL_OBJECT_TYPES.has(type);
}

/** The box an object occupies: an explicit size, or this type's default. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: finiteNumber(obj.width) ?? STICKY_SIZE_WORLD,
    height: finiteNumber(obj.height) ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of the objects lying entirely inside `rect` (the marquee's rule). */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
  isSelectable: (type: string) => boolean = isKnownObjectType,
): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (!isSelectable(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

/** Ids of every selectable object, for select all. */
export function allObjectIds(
  snapshot: readonly ObjectSnapshot[],
  isSelectable: (type: string) => boolean = isKnownObjectType,
): string[] {
  return snapshot.filter((obj) => isSelectable(obj.type)).map((obj) => obj.id);
}

/**
 * Write absolute positions for a group of objects in one transaction. A missing
 * id (somebody else deleted it) is skipped; one non-finite position refuses the
 * whole call. Returns how many objects were written.
 *
 * Gestures write absolute positions rather than applying each frame's delta
 * (design key decision 1): with two people moving the same object, absolute
 * writes converge on the last writer, on every screen.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const objects = objectsMap(doc);
  const writes: [Y.Map<unknown>, Point][] = [];
  for (const [id, point] of positions) {
    // One impossible coordinate refuses the group: a half-written layout is worse
    // than a gesture that did nothing.
    if (!isCoordinate(point.x) || !isCoordinate(point.y)) return 0;
    const entry = objects.get(id);
    if (entry) writes.push([entry, point]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [entry, point] of writes) {
      entry.set('x', point.x);
      entry.set('y', point.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Write absolute boxes (position and size) for a group of objects. The first
 * write of a note created before story 7 gives it an explicit size; nothing else
 * about it changes.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const objects = objectsMap(doc);
  const writes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, rect] of rects) {
    if (
      !isCoordinate(rect.x) ||
      !isCoordinate(rect.y) ||
      !isCoordinate(rect.width) ||
      !isCoordinate(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return 0; // an impossible box refuses the group
    }
    const entry = objects.get(id);
    if (entry) writes.push([entry, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [entry, rect] of writes) {
      entry.set('x', rect.x);
      entry.set('y', rect.y);
      entry.set('width', rect.width);
      entry.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Raise a group above every object outside it, keeping the group's own
 * stacking order: the selected objects take the numbers just above the highest
 * unselected one, in the order they already had (design key decision 4).
 * Returns how many objects changed, and writes nothing when none do.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const selected = new Set(ids);
  const moving: { id: string; entry: Y.Map<unknown>; z: number }[] = [];
  let maxUnselected = 0;
  for (const [id, entry] of objects) {
    if (selected.has(id)) {
      moving.push({ id, entry, z: numberOr(entry.get('z'), 0) });
    } else {
      maxUnselected = Math.max(maxUnselected, numberOr(entry.get('z'), 0));
    }
  }
  if (moving.length === 0) return 0;
  const ordered = moving.sort(byZThenId);
  const changes = ordered
    .map((item, rank) => ({ entry: item.entry, z: maxUnselected + rank + 1 }))
    .filter((change) => change.entry.get('z') !== change.z);
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const change of changes) change.entry.set('z', change.z);
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Remove a group of objects, skipping ids that are already gone. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present = [...new Set(ids)].filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Any arrow hanging off one of them is set free first, where it hangs, in this
    // same step: nobody is left looking at an arrow tied to a gone object.
    detachConnectorsTo(doc, new Set(present));
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
