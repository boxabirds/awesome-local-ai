// Board document model: the Yjs schema plus every mutation the app performs.
//
// Framework-free on purpose — no React, no DOM — so the Cloudflare Durable
// Object (story 4) can import this module for validation/migration, and so
// story 3 can attach a network provider to the same document without
// touching it.
//
// Document schema (this is the future persisted format of story 4 and the
// wire format of story 3, hence `meta.schemaVersion`):
//
//   Y.Doc
//     meta:    Y.Map { schemaVersion: 1 }
//     objects: Y.Map<string /* id */, Y.Map>
//       <id>: Y.Map {
//         type: 'sticky'
//         x: number, y: number   // top-left, world units
//         color: StickyColor
//         text: Y.Text
//         z: number              // stacking; higher is on top
//         createdAt: number      // epoch ms
//         width?: number         // explicit width (story 7)
//         height?: number        // explicit height (story 7)
//       }
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type StickyColor,
  type TextSize,
} from './config';
import type { Point, Rect } from './geometry';
import { rectContains } from './geometry';
import type { TextSnapshot } from './objects/text';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
} from './config';
import {
  isShapeFillColor,
  isShapeKind,
  isShapeStrokeColor,
  shapeLabel,
  type ShapeSnapshot,
} from './objects/shape';
import {
  connectorContext,
  connectorBBoxOf,
  connectorIsDetached,
  detachConnectorsTo,
  endIsAttached,
  readEndpoint,
  resolveConnectorEnds,
  type ConnectorContext,
  type ConnectorSnapshot,
} from './objects/connector';
import { readStroke, type StrokeSnapshot } from './objects/stroke';

/**
 * What the board knows about one text object. The reading of it lives here, next
 * to the reading of every other object, so this type is part of the board's
 * vocabulary too; the writes that belong to text alone live in `objects/text`.
 */
export type { TextSnapshot };

/** Transaction origin of local user edits (story 8 undo, story 3 echo guard). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Written once by `initDoc`; bumped by future migrations. */
export const SCHEMA_VERSION = 1;

const META_MAP = 'meta';
const OBJECTS_MAP = 'objects';

/**
 * A shape, and a connector with its ends resolved against the board as it is
 * now. Both types are declared next to the reads that build them; the board's
 * vocabulary holds them, because this is where the board's objects are.
 */
export type { ShapeSnapshot, ConnectorSnapshot };

/** Story 11 added the pen stroke; the reads of it live in `objects/stroke`, as every
 *  other object's do, and its name belongs to the board's vocabulary. */
export type { StrokeSnapshot };

/** Immutable read view of one sticky note object. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Explicit width in world units (written on first resize by story 7). */
  width?: number;
  /** Explicit height in world units (written on first resize by story 7). */
  height?: number;
}

/**
 * Generic snapshot for any object type (used by group ops): the union of the
 * object kinds the board knows. Story 9 added the text object to it, and every
 * group operation below works on the shared fields, which is the point.
 */
export type ObjectSnapshot =
  | StickySnapshot
  | TextSnapshot
  | ShapeSnapshot
  | ConnectorSnapshot
  | StrokeSnapshot;

/** The `objects` map: id -> per-object Y.Map. Renderer skips unknown types. */
export function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

/**
 * Finite numbers only: a document written by something other than this app can
 * hold anything in a numeric field, and nothing downstream may be handed NaN.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

/**
 * Generate an object id. `crypto.randomUUID` is used where available (all
 * target browsers, Node >= 19); the fallback keeps non-browser hosts (test
 * environments without a Web Crypto global) working.
 */
export function newId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/** Set meta.schemaVersion if absent; idempotent (no rewrite, no extra update). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP);
  if (!meta.has('schemaVersion')) meta.set('schemaVersion', SCHEMA_VERSION);
}

/** Highest z currently in the document (0 for an empty document). */
export function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((map) => {
    const z = map.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/** Is `id` the object the renderer draws last, i.e. by (z, id) order? */
function isTopmost(objects: Y.Map<Y.Map<unknown>>, id: string): boolean {
  let topZ = -Infinity;
  let topId: string | null = null;
  objects.forEach((map, key) => {
    const z = map.get('z');
    if (!isFiniteNumber(z)) return;
    if (z > topZ || (z === topZ && (topId === null || key > topId))) {
      topZ = z;
      topId = key;
    }
  });
  return topId === id;
}

/**
 * Create a sticky note centred on `at` (world units): the stored top-left is
 * `at - STICKY_SIZE_WORLD / 2`. The note is yellow unless a colour is given,
 * starts with empty text and is stacked on top of every other object.
 *
 * Returns the new id, or '' when the coordinates are not finite (nothing is
 * written, no transaction is opened).
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  const fillColor: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const objects = getObjects(doc);
  const id = newId();
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'sticky');
    map.set('x', at.x - half);
    map.set('y', at.y - half);
    map.set('color', fillColor);
    map.set('text', new Y.Text(''));
    map.set('z', maxZ(objects) + 1);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object to a new world-space top-left. False for stale ids. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raise an object above everything else (z = maxZ + 1). Returns false — and
 * writes nothing — for a stale id or for the object that is already on top,
 * so a repeated "bring to front" never produces pointless sync traffic.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (map === undefined || isTopmost(objects, id)) return false;
  doc.transact(() => {
    map.set('z', maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a sticky note's colour, leaving text, position, stacking and the
 * (client-side) selection untouched. Unknown colour names and stale ids
 * return false and write nothing.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const map = getObjects(doc).get(id);
  if (map === undefined) return false;
  doc.transact(() => {
    map.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False (no transaction) for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's Y.Text (the shared edit surface), or undefined for stale/non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = getObjects(doc).get(id);
  if (map === undefined) return undefined;
  const text = map.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * The keys of TEXT_SIZES, which is all a document may legally hold for a text
 * object's size. Exported for the text object's own setters.
 */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

/**
 * Snapshot one object map by its id, whatever kind it is, or null for a kind
 * this board does not know (forward compatibility).
 *
 * Exported for `shared/objects/text.ts`, the only other place that has to read
 * a text object back. The reading lives here rather than there so that the two
 * modules never import each other at runtime: this side takes only the text
 * object's *types*.
 */
export function readObject(
  map: Y.Map<unknown> | undefined,
  id: string,
  context?: ConnectorContext,
): ObjectSnapshot | null {
  if (map === undefined || !(map instanceof Y.Map)) return null;
  const type = map.get('type');
  const x = map.get('x');
  const y = map.get('y');
  const z = map.get('z');
  const createdAt = map.get('createdAt');
  const width = map.get('width');
  const height = map.get('height');
  const text = map.get('text');
  const createdBy = map.get('createdBy');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  const shared = {
    id,
    x,
    y,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    ...(isFiniteNumber(width) ? { width } : {}),
    ...(isFiniteNumber(height) ? { height } : {}),
  };
  if (type === 'sticky') {
    return Object.freeze({
      ...shared,
      type: 'sticky' as const,
      color: isStickyColor(map.get('color')) ? map.get('color') as StickyColor : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
    });
  }
  if (type === 'text') {
    const size = map.get('size');
    return Object.freeze({
      ...shared,
      type: 'text' as const,
      text: text instanceof Y.Text ? text.toString() : '',
      size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
      widthMode: map.get('widthMode') === 'fixed' ? ('fixed' as const) : ('auto' as const),
      // A text object always has a box; a document that lost one keeps it on the
      // board at the narrowest legal width instead of dropping the text.
      width: Math.max(TEXT_MIN_WIDTH_WORLD, shared.width ?? TEXT_MIN_WIDTH_WORLD),
      height: Math.max(0, shared.height ?? 0),
    });
  }
  // Story 10: a shape. The kind and both colour names are validated on the way
  // in, so a document written by something else is drawn with the defaults
  // rather than thrown away or thrown at. A shape always has a box.
  if (type === 'shape') {
    if (!(isFiniteNumber(width) && isFiniteNumber(height))) return null;
    const rawKind = map.get('kind');
    const rawFill = map.get('fill');
    const rawStroke = map.get('stroke');
    return Object.freeze({
      ...shared,
      type: 'shape' as const,
      width,
      height,
      kind: isShapeKind(rawKind) ? (rawKind as ShapeKind) : ('rect' as ShapeKind),
      fill: isShapeFillColor(rawFill) ? (rawFill as ShapeFillColor) : (DEFAULT_SHAPE_FILL as ShapeFillColor),
      stroke: isShapeStrokeColor(rawStroke)
        ? (rawStroke as ShapeStrokeColor)
        : (DEFAULT_SHAPE_STROKE as ShapeStrokeColor),
      label: shapeLabel(map),
      ...(typeof createdBy === 'string' && createdBy !== '' ? { createdBy } : {}),
    });
  }
  // Story 10: a connector. Everything about where it goes is in its two ends, so
  // this is the one object whose snapshot is worked out rather than copied: the
  // ends are resolved against the board as it stands, and the box is the box of
  // the two points they land on. An arrow whose object is gone is a drawn object,
  // not a broken one, and says so with `detached`.
  if (type === 'connector') {
    const from = readEndpoint(map.get('from'));
    const to = readEndpoint(map.get('to'));
    if (from === null || to === null) return null;
    const ends = connectorContextOf(map, context);
    const resolved = resolveConnectorEnds({ from, to }, ends.rects);
    const box = connectorBBoxOf(resolved);
    return Object.freeze({
      ...shared,
      type: 'connector' as const,
      from,
      to,
      resolved,
      attached: {
        from: endIsAttached(from, ends.ids),
        to: endIsAttached(to, ends.ids),
      },
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      detached: connectorIsDetached({ from, to }, ends.ids),
      ...(typeof createdBy === 'string' && createdBy !== '' ? { createdBy } : {}),
    });
  }
  // Story 11: a pen stroke. Its points are the whole of it, and a stroke whose points
  // cannot be drawn is not on the board at all — there would be nothing to see and
  // nothing to click — which is the one thing `readStroke` decides for itself.
  if (type === 'stroke') return readStroke(map, id);
  return null;
}

/**
 * The boxes and ids a connector needs to be read against. `snapshotAll` passes
 * one it gathered for the whole board, so a hundred connectors cost one walk of
 * the objects; a lone `readObject` call gathers its own.
 */
function connectorContextOf(map: Y.Map<unknown>, provided?: ConnectorContext): ConnectorContext {
  if (provided !== undefined) return provided;
  const doc: Y.Doc | null = map.doc;
  if (doc === null || doc === undefined) return { rects: new Map(), ids: new Set() };
  return connectorContext(doc);
}

/**
 * Immutable, render-ready view of the board: notes sorted by (z, id) — the id
 * tie-break keeps stacking identical on every client once story 3 syncs —
 * with objects of unknown `type` skipped (forward compatibility for the
 * shapes/text/images of stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  getObjects(doc).forEach((map, id) => {
    if (map === undefined || !(map instanceof Y.Map) || map.get('type') !== 'sticky') return;
    const x = map.get('x');
    const y = map.get('y');
    const z = map.get('z');
    const createdAt = map.get('createdAt');
    const color = map.get('color');
    const text = map.get('text');
    const width = map.get('width');
    const height = map.get('height');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    notes.push(
      Object.freeze({
        id,
        type: 'sticky' as const,
        x,
        y,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z,
        createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
        ...(isFiniteNumber(width) ? { width } : {}),
        ...(isFiniteNumber(height) ? { height } : {}),
      }),
    );
  });
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

// --- Story 7: group operations -----------------------------------------------

/**
 * Every object the board can draw, of any known kind, sorted by (z, id) like
 * `snapshot` sorts its notes. This is what the board renders and what selection
 * works on, so a text object is selectable, movable, deletable and marqueeable
 * without any of those operations changing.
 */
export function snapshotAll(doc: Y.Doc, context?: ConnectorContext): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  const rects = context ?? connectorContext(doc);
  getObjects(doc).forEach((map, id) => {
    const obj = readObject(map, id, rects);
    if (obj !== null) objects.push(obj);
  });
  objects.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return objects;
}

/**
 * Compute the bounding rect of an object. For stickies without explicit
 * width/height, uses STICKY_SIZE_WORLD as the fallback.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Return ids of objects in `snapshot` whose bounds are fully inside `rect`.
 * Used by marquee selection.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/**
 * Return all object ids from the snapshot (only objects of known/registered
 * types are included — unknown types are already filtered out by `snapshot()`).
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * Move multiple objects to absolute positions. Returns the number of objects
 * actually moved (skips missing ids). One transaction per call.
 * Rejects non-finite positions with 0 and no transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  // Validate all positions are finite
  for (const [, pt] of positions) {
    if (!isFiniteNumber(pt.x) || !isFiniteNumber(pt.y)) return 0;
  }
  const objects = getObjects(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, pt] of positions) {
      const map = objects.get(id);
      if (map === undefined) continue;
      // Story 10: an arrow is not in this list. An arrow has no corner of its own
      // to be moved to — the box it is drawn in belongs to its ends, and a fastened
      // end belongs to somebody else's shape — so the position asked for here means
      // nothing for one, and the drag that moves an arrow says where its free ends
      // are instead (`setConnectorFreeEnds`). Moving the shapes an arrow joins is
      // how an arrow is moved about a board anyway.
      if (map.get('type') === 'connector') continue;
      map.set('x', pt.x);
      map.set('y', pt.y);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/** A stored number, or what to answer when it is not one. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Resize multiple objects by writing width and height (and x, y).
 * Returns the number of objects actually resized. One transaction per call.
 * Rejects non-finite values with 0 and no transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  for (const [, r] of rects) {
    if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return 0;
  }
  const objects = getObjects(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, r] of rects) {
      const map = objects.get(id);
      if (map === undefined) continue;
      // A connector is stretched by moving its ends, never by a box handle, so a
      // resize of one is nothing at all — which is also the answer if an overlay
      // ever draws handles it should not.
      if (map.get('type') === 'connector') continue;
      map.set('x', r.x);
      map.set('y', r.y);
      map.set('width', r.width);
      map.set('height', r.height);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Raise all specified objects above all unselected objects while preserving
 * relative z-order among the selected ones. Returns the number changed.
 * Assigns z values starting at maxUnselectedZ + 1.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const idSet = new Set(ids);

  // Find max z among unselected objects
  let maxUnselectedZ = 0;
  objects.forEach((map, key) => {
    if (idSet.has(key)) return;
    const z = map.get('z');
    if (isFiniteNumber(z) && z > maxUnselectedZ) maxUnselectedZ = z;
  });

  // Collect selected objects with their current z
  const selected: { id: string; map: Y.Map<unknown>; z: number }[] = [];
  for (const id of ids) {
    const map = objects.get(id);
    if (map === undefined) continue;
    const z = map.get('z');
    selected.push({ id, map, z: isFiniteNumber(z) ? z : 0 });
  }
  if (selected.length === 0) return 0;

  // Sort by current z to preserve relative order
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = maxUnselectedZ + i + 1;
      if (selected[i].map.get('z') !== newZ) {
        selected[i].map.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete multiple objects. Returns the number actually deleted. One
 * transaction per call. Skips missing ids.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const deleted = ids.filter((id) => objects.has(id));
  if (deleted.length === 0) return 0;
  let count = 0;
  doc.transact(() => {
    // Story 10: an arrow that pointed at one of these objects does not go with
    // it — its end is turned into a free one at the point its target was last
    // drawn at. Doing that here, inside the same transaction as the deletion,
    // is what makes the arrow and the deletion one update and one undo step:
    // Undo brings the object back *and* re-attaches the arrow to it.
    detachConnectorsTo(doc, deleted);
    for (const id of deleted) {
      objects.delete(id);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}
