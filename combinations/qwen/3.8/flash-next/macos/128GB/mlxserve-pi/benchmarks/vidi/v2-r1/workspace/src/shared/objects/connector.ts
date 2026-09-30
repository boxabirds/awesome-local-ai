// The connector object's part of the board document (`connectors.model`).
//
// A connector is the board's first kind of object with *no position of its own*. It
// stores two ends, each either attached to an object or a point, and is drawn between
// wherever those ends currently are — which is the whole reason an arrow follows a
// shape instead of staying where it was drawn (`connector.follow`). Nothing in the
// document says where an arrow is; it says what it points at.
//
// Schema of one connector (design.md, "Document schema addition"):
//   objects/<id>: Y.Map {
//     type: 'connector',
//     from: {kind:'attached', objectId, fallback?} | {kind:'free', x, y},
//     to:   same shape,
//     z, createdAt, createdBy
//   }
//
// `x`, `y`, `width` and `height` are written as zeroes and ignored on the way back:
// the generic snapshot derives them from the resolved ends, so that selection, the
// marquee, the overlay and a group transform see an arrow's real box without any of
// them knowing what an arrow is.
//
// Deleting an object puts down the arrows attached to it (`connector.detach`). That
// rule is *registered* with `board-model` rather than imported by it, so that the
// model that knows nothing about connectors still keeps arrows alive when a note, a
// text block or a shape goes — the same direction of dependency story 9 chose for
// `registerObjectTypeModel`, and for the same reason: no cycle.
//
// Like the rest of `src/shared`, this file may not touch the DOM.
import * as Y from 'yjs';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_STROKE_WIDTH_WORLD,
  MAX_OBJECT_SIZE_WORLD,
} from '../config';
import {
  LOCAL_ORIGIN,
  objectRects,
  registerObjectDeleteObserver,
  registerObjectTypeModel,
  registerObjectTypeReader,
  type BoardObject,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';

import { distance, distanceToPolyline } from '../geometry/polyline';
import {
  connectorBBox,
  isEndpoint,
  resolveEndpoints,
  type ConnectorEnd,
  type ConnectorEnds,
  type Endpoint,
  type ResolvedConnector,
} from '../geometry/connector-geometry';

/** A connector as the board reads it, with its ends resolved into a box. */
export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  /** The ends as stored. Their *points* are what `x`/`y`/`width`/`height` came from. */
  from: Endpoint;
  to: Endpoint;
  /** Who made it. Story 6 (identity) is not built, so this is the local device id. */
  createdBy?: string;
  createdAt?: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const isConnector = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'connector';

/**
 * Tell the shared model that a `connector` object exists. It has no size of its own
 * to protect — an arrow is as long as the gap it spans — so no minimum.
 */
registerObjectTypeModel('connector', 0);
// And how it is read: its box is not in the document, it is between two objects.
registerObjectTypeReader('connector', readConnectorObject);
// And what happens to it when something it points at is deleted. Registered rather
// than called from `deleteObjects`, so `board-model` never imports this file.
registerObjectDeleteObserver(detachConnectorsTo);

/**
 * Draw an arrow between two ends, in one local transaction, above every other
 * object. Returns the new id, or null when the request is not a request — and then
 * nothing at all is written:
 *
 * - an end that is neither attached nor a point, so there is nothing to draw to;
 * - both ends on the same object, because an arrow from a shape to itself is a
 *   circle nobody asked for (`connector.creation`);
 * - shorter than `CONNECTOR_MIN_LENGTH_WORLD` once resolved, which is what a click
 *   with the Connector tool looks like: the pointer went down and came up almost
 *   where it started, and that is a click, not an arrow.
 *
 * An attached end is stored with the point it was attached at, so an arrow whose
 * object is deleted later is drawn where it was drawn rather than somewhere the
 * board can still resolve.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  const rects = objectRects(doc);
  const ends = resolveEndpoints({ from, to }, rects);
  if (distance(ends.from, ends.to) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    const z = value instanceof Y.Map ? value.get('z') : undefined;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', 'connector');
    object.set('from', storeEndpoint(from, ends.from));
    object.set('to', storeEndpoint(to, ends.to));
    // Position is derived, never stored; these are here so that every object has the
    // same fields and a stale reader sees a number instead of undefined.
    object.set('x', 0);
    object.set('y', 0);
    object.set('z', maxZ + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', typeof by === 'string' ? by : '');
    objectsMap(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an arrow — the two handles a selected connector shows.
 *
 * Dropping the end on an object attaches it to that object (with the point remembered
 * as a fallback), dropping it on empty board makes it a free point at the place it was
 * let go (`connector.endpoint_drag`). Two refusals, both written without a
 * transaction: the end that would point an arrow at itself, and an end that is not an
 * end at all. Nothing else about the connector is touched, so a drag that ends next to
 * a shape does not re-pull the other end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  next: Endpoint,
): boolean {
  const object = objectsMap(doc).get(id);
  if (!isConnector(object)) return false;
  if (end !== 'from' && end !== 'to') return false;
  if (!isEndpoint(next)) return false;
  const current = readEndpoint(object.get(end));
  const otherEnd = end === 'from' ? 'to' : 'from';
  const other = readEndpoint(object.get(otherEnd));
  if (current === null || other === null) return false;
  // An arrow points at something else: neither itself nor its own other end.
  if (next.kind === 'attached' && (next.objectId === id || sameEndpoint(other, next))) {
    return false;
  }
  if (sameEndpoint(current, next)) return false;

  const ends: ConnectorEnds =
    end === 'from' ? { from: next, to: other } : { from: other, to: next };
  const resolved = resolveEndpoints(ends, objectRects(doc));
  const stored = storeEndpoint(next, end === 'from' ? resolved.from : resolved.to);
  doc.transact(() => {
    object.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Put down every arrow end attached to one of `deletedIds`, in one transaction, at the
 * point it was attached at (`connector.detach`).
 *
 * This runs from inside `deleteObjects`' transaction, before the objects go, which is
 * why the anchors are still resolvable: the arrow is asked where it is *now* and keeps
 * exactly that as its new, own point. Delete a shape and its arrows stay on the board
 * drawn where they were, and one undo brings the shape back under them.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): number {
  if (deletedIds.length === 0) return 0;
  const gone = new Set(deletedIds);
  const rects = objectRects(doc);
  const objects = objectsMap(doc);

  const rewrites = new Map<string, ConnectorEnds>();
  objects.forEach((value, key) => {
    if (!isConnector(value)) return;
    const ends = readEnds(value);
    if (ends === null) return;
    // Resolved against the board as it is *before* the delete: this is where the
    // arrow ends right now, and "where it was attached" is the whole rule.
    const points = resolveEndpoints(ends, rects);
    let detached: ConnectorEnds | null = null;
    if (ends.from.kind === 'attached' && gone.has(ends.from.objectId)) {
      detached = { from: { kind: 'free', x: points.from.x, y: points.from.y }, to: ends.to };
    }
    if (ends.to.kind === 'attached' && gone.has(ends.to.objectId)) {
      const free = { kind: 'free', x: points.to.x, y: points.to.y } as const;
      detached = { from: detached?.from ?? ends.from, to: free };
    }
    if (detached !== null) rewrites.set(key, detached);
  });

  if (rewrites.size === 0) return 0;
  doc.transact(() => {
    rewrites.forEach((ends, id) => {
      const object = objects.get(id);
      if (!isConnector(object)) return;
      object.set('from', ends.from);
      object.set('to', ends.to);
    });
  }, LOCAL_ORIGIN);
  return rewrites.size;
}

/**
 * An attached end keeps the point it was resolved to as its fallback: the arrow is
 * drawn from there for as long as its object is missing, and from the object for as
 * long as it is there.
 */
function storeEndpoint(endpoint: Endpoint, at: Point): Endpoint {
  if (endpoint.kind === 'free') return { kind: 'free', x: endpoint.x, y: endpoint.y };
  return { kind: 'attached', objectId: endpoint.objectId, fallback: { x: at.x, y: at.y } };
}

/** Two ends that mean the same thing. */
function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  return a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId;
}

/** An endpoint that came out of the document, or null when it is not one. */
function readEndpoint(value: unknown): Endpoint | null {
  return isEndpoint(value) ? (value as Endpoint) : null;
}

/** Both ends of a stored connector, or null when either one is broken. */
function readEnds(object: Y.Map<unknown>): ConnectorEnds | null {
  const from = readEndpoint(object.get('from'));
  const to = readEndpoint(object.get('to'));
  return from !== null && to !== null ? { from, to } : null;
}

/**
 * Read one connector out of the document — including where it is drawn, which is not
 * in the document.
 */
export function readConnectorSnapshot(doc: Y.Doc, id: string): ConnectorSnapshot | null {
  const object = objectsMap(doc).get(id);
  if (!isConnector(object)) return null;
  return readConnector(id, object, objectRects(doc));
}

/**
 * The same read from the `Y.Map` the board already holds, resolving the ends against
 * the objects in the document that holds it. This is the reader `snapshotObjects` uses
 * for a connector; `board-model` does not import it, it is registered.
 *
 * An arrow with a broken end is not an arrow: it reads as nothing, so nothing is drawn
 * and nothing can be selected by it.
 */
export function readConnectorObject(
  id: string,
  object: Y.Map<unknown> | undefined,
): ConnectorSnapshot | null {
  if (!isConnector(object)) return null;
  const doc = object.doc;
  return readConnector(id, object, doc === null ? new Map() : objectRects(doc));
}

function readConnector(
  id: string,
  object: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnapshot | null {
  const ends = readEnds(object);
  if (ends === null) return null;
  const points = resolveEndpoints(ends, rects);
  const box = connectorBox(points);
  const createdBy = object.get('createdBy');
  const createdAt = object.get('createdAt');
  return {
    id,
    type: 'connector',
    // Derived, in board units: the box the arrow occupies, stroke included.
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    from: ends.from,
    to: ends.to,
    createdBy: typeof createdBy === 'string' ? createdBy : undefined,
    createdAt: isFiniteNumber(createdAt) ? createdAt : undefined,
  };
}

/** The box an arrow is drawn in: its two ends, and its own thickness. */
export const connectorBox = (points: ResolvedConnector): Rect =>
  connectorBBox(points.from, points.to, CONNECTOR_STROKE_WIDTH_WORLD);

/** True for the kind that is drawn between two objects instead of on one. */
export const isConnectorSnapshot = (object: BoardObject): object is ConnectorSnapshot =>
  object.type === 'connector';

/**
 * An arrow is as long as the gap it spans, and no bigger than the one size every
 * object shares; that is all `connector.max_size` means for an object that stores no
 * size.
 */
export const connectorMaxLength = CONNECTOR_MIN_LENGTH_WORLD;
export const connectorMaxSize = MAX_OBJECT_SIZE_WORLD;

/** Every connector in the document, in draw order. */
export function connectorSnapshots(doc: Y.Doc): ConnectorSnapshot[] {
  const out: ConnectorSnapshot[] = [];
  objectsMap(doc).forEach((_value, key) => {
    const snapshot = readConnectorSnapshot(doc, key);
    if (snapshot) out.push(snapshot);
  });
  return out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
}

/**
 * The two points an arrow is drawn between, given what is on the board (`rects`, the
 * same boxes the snapshot was taken with). An end attached to an object that is not in
 * there is drawn at the place it was attached at (`endpointFallback`).
 */
export function connectorPointsOf(
  connector: ConnectorSnapshot,
  rects: ReadonlyMap<string, Rect>,
): [Point, Point] {
  const resolved = resolveEndpoints({ from: connector.from, to: connector.to }, rects);
  return [resolved.from, resolved.to];
}

/**
 * Would a click here hit this arrow? (`connector.select`, TC-14, TC-20.)
 *
 * The tolerance is a number of *screen* pixels, so it becomes board units by dividing
 * by the zoom: six pixels is three board units at 200% and twelve at 50%. Everything
 * that decides what a click selects — this function, and the width of the arrow's own
 * invisible pointer target on the screen — asks the same question, so that "within six
 * pixels of the line" means one thing.
 */
export function hitTestConnector(
  connector: ConnectorSnapshot,
  point: Point,
  zoom: number,
  rects: ReadonlyMap<string, Rect> = new Map(),
): boolean {
  if (!(zoom > 0)) return false;
  const points = connectorPointsOf(connector, rects);
  return distanceToPolyline(points, point) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

/**
 * How wide the arrow's invisible target is, in board units, at this zoom: twice the
 * tolerance, because a line is hit on either side of it. The component draws a stroke
 * this wide and lets the browser do the geometry, so the rule the tests check is the
 * rule the pointer follows.
 */
export const connectorHitWidthWorld = (zoom: number): number =>
  zoom > 0 ? (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom : 0;
