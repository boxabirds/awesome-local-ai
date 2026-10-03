// The connector (arrow) model (story 10).
//
// An arrow owns no geometry of its own. It stores *which two things it joins* — an
// object plus the point to fall back to when that object is gone, or a free point in
// space — and its line is computed from those objects every time anything looks at
// it. That one decision is why an arrow follows a shape when anyone drags it, why it
// never needs a "retarget" message when a shape moves past it, and why two people
// dragging the same shape see the same arrow without a single extra byte on the wire.
// A tool that bakes the anchor points in gets this wrong the moment somebody moves a
// box.
//
// What the model does guard: an arrow may not be a self-loop (connector.no_self), may
// not be as short as a stray click (connector.no_accidental), must survive the death
// of what it pointed at (connector.detaches), and must never be rewritten by a client
// that is guessing.
//
// Like story 9's text module, this file reads the `objects` map itself and imports
// only LOCAL_ORIGIN and the shared types from board-model, so the dependency runs one
// way: the arrow's model is built on the board's model. board-model calls
// `detachConnectorsTo` from `deleteObjects`. One LOCAL_ORIGIN transaction per intent.

import * as Y from 'yjs';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry/geometry';
import {
  connectorBBox,
  endToward,
  endpointAnchor,
  isEndpoint,
  resolveEndpoints,
  type ConnectorEnds,
  type Endpoint,
} from '../geometry/connector-geometry';

export type { Endpoint };

const OBJECTS = 'objects';

type Objects = Y.Map<Y.Map<unknown>>;

function objects(doc: Y.Doc): Objects {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

/** The id of a new object: the same rule sticky notes and text objects use. */
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

/** Highest `z` across every object (any type), so a new arrow lands on top. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/** Which end of an arrow an operation is about. */
export type ConnectorEnd = 'from' | 'to';

/**
 * A connector as the model sees it. `x`, `y`, `width` and `height` are stored as 0
 * and never read back: the snapshot reports the box its two drawn points occupy,
 * which is what frames its selection and handles and puts it in a marquee (TC-29).
 * `endpoints` is the resolved line, derived by the same function the renderer calls —
 * so what a test measures is what a person sees.
 */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  endpoints: { from: Point; to: Point };
  width: number;
  height: number;
  createdBy: string;
}

/** The two ends of a stored arrow, in whatever form they travel in. */
function readEnds(map: Y.Map<unknown>): ConnectorEnds | null {
  const from = map.get('from');
  const to = map.get('to');
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  return { from, to };
}

/** The object an end is joined to, or null when it is a free point. */
export function endpointObjectId(end: Endpoint): string | null {
  return end.kind === 'attached' ? end.objectId : null;
}

/**
 * The box of every object in the document, by id: the map an arrow resolves against.
 *
 * Each type's box is read the way that type's own module reads it — a shape's and a
 * text object's width and height are their own, a sticky note created before story 7
 * has neither and renders at STICKY_SIZE_WORLD, and an arrow's box is derived from its
 * two points (a rough one, from the points it stored, because an arrow's real box
 * depends on the boxes in this very map and is computed properly in
 * `connectorFromMap`). board-model builds the same map out of the snapshots it hands
 * the renderer; the two agree because both follow those rules.
 */
export function objectRectsFromDoc(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objects(doc).forEach((map, id) => {
    const type = map.get('type');
    if (type === 'connector') {
      const ends = readEnds(map);
      if (!ends) return;
      rects.set(id, connectorBBox(endpointStoredPoint(ends.from), endpointStoredPoint(ends.to)));
      return;
    }
    const width = map.get('width');
    const height = map.get('height');
    rects.set(id, {
      x: finiteOr(map.get('x'), 0),
      y: finiteOr(map.get('y'), 0),
      width: isFiniteNumber(width)
        ? width
        : type === 'text'
          ? TEXT_MIN_WIDTH_WORLD
          : type === 'shape'
            ? SHAPE_DEFAULT_SIZE_WORLD
            : STICKY_SIZE_WORLD,
      height: isFiniteNumber(height)
        ? height
        : type === 'text'
          ? Math.round(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT)
          : type === 'shape'
            ? SHAPE_DEFAULT_SIZE_WORLD
            : STICKY_SIZE_WORLD,
    });
  });
  return rects;
}

/**
 * Where an endpoint sits according to its own stored numbers, with nothing resolved:
 * a free point, or the fallback a joined point carries. board-model uses it to give an
 * arrow a provisional box in the same pass it reads the other objects, so even an
 * arrow can be pointed at by another arrow.
 */
export function endpointStoredPoint(end: Endpoint): Point {
  return end.kind === 'free' ? { x: end.x, y: end.y } : end.fallback;
}

/** How far apart an arrow's two drawn points are, in board units. */
export function connectorLength(
  ends: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): number {
  const resolved = resolveEndpoints(ends, rects);
  return Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
}

/**
 * An end with its fallback set to where it actually draws, so that when the object it
 * is joined to is deleted the arrow's end stays exactly where it was painted instead
 * of jumping to a stale corner. (connector.detaches.)
 */
function withAnchor(
  end: Endpoint,
  toward: Point,
  rects: ReadonlyMap<string, Rect>,
): Endpoint {
  if (end.kind !== 'attached') return end;
  if (!rects.get(end.objectId)) return end;
  return {
    kind: 'attached',
    objectId: end.objectId,
    fallback: endpointAnchor(end, toward, rects),
  };
}

/**
 * Create an arrow between two endpoints, in exactly one transaction.
 *
 * Returns the new id, or null — having written nothing, so nothing goes on the wire —
 * when the request is not sound: an end that is neither a point nor a join, an arrow
 * whose two ends are the same object (connector.no_self), or an arrow shorter than
 * CONNECTOR_MIN_LENGTH_WORLD, which is a stray click and not an arrow
 * (connector.no_accidental, TC-09). Length is measured on the *resolved* line, so two
 * shapes that touch do not yield an arrow merely because the pointer travelled.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (typeof by !== 'string' || by === '') return null;
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }
  const rects = objectRectsFromDoc(doc);
  if (connectorLength({ from, to }, rects) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Store each joined end with the anchor it currently resolves to: that is the
  // place it will be released to if the object it points at disappears.
  const storedFrom = withAnchor(from, endToward(to, rects), rects);
  const storedTo = withAnchor(to, endToward(from, rects), rects);
  const id = newId();

  doc.transact(() => {
    // z is read inside the transaction, so two people drawing at the same moment get
    // two different layers.
    const connector = new Y.Map<unknown>();
    connector.set('type', 'connector');
    // An arrow owns no position: these are placeholders, overwritten in the snapshot
    // by the derived box, and they let a client that does not know connectors still
    // read the record without choking.
    connector.set('x', 0);
    connector.set('y', 0);
    connector.set('width', 0);
    connector.set('height', 0);
    connector.set('from', storedFrom);
    connector.set('to', storedTo);
    connector.set('z', maxZ(doc) + 1);
    connector.set('createdAt', Date.now());
    connector.set('createdBy', by);
    objects(doc).set(id, connector);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Move one end of an arrow — its tail, its head, or the same arrow's other end a
 * moment later. True when it was written; false — with no transaction, hence nothing
 * on the wire — when the arrow is gone (someone else deleted it), when the new end is
 * not a sound point, or when the end would join the object the *other* end is already
 * joined to. That last rule is not decoration: an arrow from a shape to itself is a
 * dot nobody asked for, and a client holding only one end cannot know it would make
 * one. (connector.reconnect, connector.no_self, TC-12.)
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  pointOrObject: Endpoint,
): boolean {
  if (end !== 'from' && end !== 'to') return false;
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'connector') return false;
  if (!isEndpoint(pointOrObject)) return false;
  const ends = readEnds(map);
  if (!ends) return false;
  const other = end === 'from' ? ends.to : ends.from;
  if (
    pointOrObject.kind === 'attached' &&
    other.kind === 'attached' &&
    pointOrObject.objectId === other.objectId
  ) {
    return false;
  }
  const rects = objectRectsFromDoc(doc);
  const stored = withAnchor(pointOrObject, endToward(other, rects), rects);
  doc.transact(() => {
    map.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Release every arrow that pointed at one of `deletedIds`, leaving each end where it
 * was last drawn.
 *
 * This is the one place an arrow is rewritten by something other than the person
 * holding it, and it is deliberately *not* a "delete the arrows too" cascade: the
 * arrow is the only object whose meaning is about other objects, so when one of them
 * is deleted what is left is an arrow pointing at a memory of a place. It becomes a
 * free arrow there (connector.detaches), which the CRDT handles without a conflict —
 * one person deletes the shape, its arrows are released in the same transaction, and
 * whoever was dragging that shape simply finds their drag has nothing left to move.
 *
 * It writes without opening a transaction of its own, because its caller
 * (`deleteObjects`) has one open: a shape and the release of its arrows must be one
 * step of undo, and the document must never be seen with an arrow joined to an object
 * that is gone. That is also why it reads the boxes *before* the deletions land —
 * that is the last moment the anchor still exists.
 */
export function detachConnectorsTo(
  doc: Y.Doc,
  deletedIds: readonly string[],
): void {
  if (!deletedIds || deletedIds.length === 0) return;
  const gone = new Set(deletedIds);
  const rects = objectRectsFromDoc(doc);
  // Collect first: never mutate the map being iterated.
  const connectors: Y.Map<unknown>[] = [];
  objects(doc).forEach((map) => {
    if (map.get('type') === 'connector') connectors.push(map);
  });
  for (const map of connectors) {
    const ends = readEnds(map);
    if (!ends) continue;
    const { from, to } = ends;
    let nextFrom: Endpoint | null = null;
    let nextTo: Endpoint | null = null;
    if (from.kind === 'attached' && gone.has(from.objectId)) {
      const anchor = endpointAnchor(from, endToward(to, rects), rects);
      nextFrom = { kind: 'free', x: anchor.x, y: anchor.y };
    }
    if (to.kind === 'attached' && gone.has(to.objectId)) {
      const anchor = endpointAnchor(to, endToward(from, rects), rects);
      nextTo = { kind: 'free', x: anchor.x, y: anchor.y };
    }
    if (!nextFrom && !nextTo) continue;
    // Only the end that was released is written; the other one is left exactly as it
    // is, so a detach changes two fields at most and says nothing about the rest.
    if (nextFrom) map.set('from', nextFrom);
    if (nextTo) map.set('to', nextTo);
  }
}

/** One arrow, read from the document. Undefined when `id` is not a sound arrow. */
export function connectorSnapshot(doc: Y.Doc, id: string): ConnectorSnap | undefined {
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'connector') return undefined;
  return connectorFromMap(id, map, objectRectsFromDoc(doc));
}

/**
 * Read an arrow's stored fields and resolve them against `rects`, the boxes of the
 * objects it joins. The box this returns is the bounds of the resolved line: an
 * arrow's position is a question about two other objects, never a stored fact, and
 * that is what makes it follow them (connector.follows, TC-29).
 */
export function connectorFromMap(
  id: string,
  map: Y.Map<unknown>,
  rects: ReadonlyMap<string, Rect>,
): ConnectorSnap | undefined {
  const ends = readEnds(map);
  if (!ends) return undefined;
  const endpoints = resolveEndpoints(ends, rects);
  const box = connectorBBox(endpoints.from, endpoints.to);
  return {
    id,
    type: 'connector',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: finiteOr(map.get('z'), 0),
    createdAt: finiteOr(map.get('createdAt'), 0),
    createdBy: typeof map.get('createdBy') === 'string' ? (map.get('createdBy') as string) : '',
    from: ends.from,
    to: ends.to,
    endpoints,
  };
}
