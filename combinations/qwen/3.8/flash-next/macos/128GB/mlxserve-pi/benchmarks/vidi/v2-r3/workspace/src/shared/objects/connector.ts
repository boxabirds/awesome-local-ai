// Connector objects: arrows that stay attached to the objects they join.
//
// A connector stores its two ends, not its shape. An end is either `free` — a
// point in board space — or `attached` to an object id plus the point to draw to
// when that object is no longer on the board. The line itself is worked out
// afresh from where the objects it points at currently are, on every read, so a
// shape moved by anybody, anywhere, takes its arrows with it without anything
// being written for it.
//
// Creating a connector validates before it writes — one transaction, so one
// update and one undo step — and refuses a self-connection or a line shorter than
// `CONNECTOR_MIN_LENGTH_WORLD` without opening a transaction at all.
import * as Y from 'yjs';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  type ConnectorEndpoint,
  type ConnectorSide,
} from '../config';
import type { Point, Rect } from '../geometry';
import { distanceToPolyline } from '../geometry/polyline';
import { connectorBBox, nearestSide, sideAnchor } from '../geometry/connector-geometry';
import { getObjects, LOCAL_ORIGIN, newId, readObject } from '../board-model';

export type { ConnectorEndpoint, ConnectorSide } from '../config';

/**
 * A connector as the board reads it. `x`, `y`, `width` and `height` are the
 * bounding box of the two resolved ends, which is what selection, marquee and
 * the overlay work from; `resolved` is where the ends draw themselves right now;
 * `detached` says an attached end's object is gone, so the arrow is drawn at the
 * point it fell back to rather than vanishing with it.
 */
export interface ConnectorSnapshot {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  resolved: { from: Point; to: Point };
  /** Whether each end is drawn stuck to a shape that is on the board. An arrow
   * whose shape was deleted has an end that is no longer stuck to anything, and
   * the two ends of one arrow can be in different cases. */
  attached: { from: boolean; to: boolean };
  detached: boolean;
  createdBy?: string;
}

/** The two ends of a connector, as stored, before any geometry is worked out. */
export interface ConnectorEnds {
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
}

/** A new connector: two ends, and the person who drew it if there is one. */
export interface ConnectorCreation {
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  createdBy?: string;
}

/** Which of an arrow's two ends is meant. */
export type ConnectorEnd = 'from' | 'to';

/** Everything a connector read needs from the rest of the board at once. */
export interface ConnectorContext {
  /** Boxes of every object that has one, by id. */
  rects: ReadonlyMap<string, Rect>;
  /** Every object id the board holds, whether it has a box or not. */
  ids: ReadonlySet<string>;
}

function isFinitePoint(value: unknown): value is Point & { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return (
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

/** One stored end, or null when it is neither kind it could be. */
export function readEndpoint(value: unknown): ConnectorEndpoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw['kind'] === 'free') {
    return isFinitePoint(raw) ? { kind: 'free', x: raw['x'] as number, y: raw['y'] as number } : null;
  }
  if (raw['kind'] === 'attached') {
    const objectId = raw['objectId'];
    const fallback = raw['fallback'];
    if (typeof objectId !== 'string' || objectId === '' || !isFinitePoint(fallback)) return null;
    return { kind: 'attached', objectId, fallback: { x: fallback.x, y: fallback.y } };
  }
  return null;
}

/** Both stored ends of an object, or null. Structural, so a malformed object is
 *  refused rather than drawn as an arrow that goes nowhere. */
export function isConnectorEnds(value: unknown): value is ConnectorEnds {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as { from?: unknown; to?: unknown };
  return readEndpoint(raw['from']) !== null && readEndpoint(raw['to']) !== null;
}

/** A plain object to store: an endpoint as it lives in the document. */
function endpointToJSON(endpoint: ConnectorEndpoint): Record<string, unknown> {
  return endpoint.kind === 'free'
    ? { kind: 'free', x: endpoint.x, y: endpoint.y }
    : {
        kind: 'attached',
        objectId: endpoint.objectId,
        fallback: { x: endpoint.fallback.x, y: endpoint.fallback.y },
      };
}

/**
 * The point an end is drawn to: the middle of the side of its object that faces
 * `aim`, or the point it holds when it is free, or the point it last saw when its
 * object is gone.
 */
export function endpointAnchor(endpoint: ConnectorEndpoint, rects: ReadonlyMap<string, Rect>, aim: Point): Point {
  if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
  const rect = rects.get(endpoint.objectId);
  if (rect === undefined) return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  return sideAnchor(rect, nearestSide(rect, aim));
}

/** Where the other end currently is, which is what decides a side. */
function aimOf(endpoint: ConnectorEndpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
  const rect = rects.get(endpoint.objectId);
  if (rect === undefined) return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Where both ends draw themselves, given the boxes the board currently holds.
 *
 * An attached end is never stored as a point — a stored point goes stale the
 * moment somebody drags the shape — so it is recomputed here from the live rect:
 * the side facing the other end, and the middle of that side. That is what makes
 * an arrow follow its objects, and what turns it round to the far side when one
 * shape is dragged past the other. An object that is gone leaves its end at the
 * fallback it was last seen at (connector.orphaned_renders).
 */
export function resolveConnectorEnds(ends: ConnectorEnds, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point } {
  return {
    from: endpointAnchor(ends.from, rects, aimOf(ends.to, rects)),
    to: endpointAnchor(ends.to, rects, aimOf(ends.from, rects)),
  };
}

/** Whether either end is attached to an object the board no longer holds. */
export function connectorIsDetached(ends: ConnectorEnds, ids: ReadonlySet<string>): boolean {
  return (
    (ends.from.kind === 'attached' && !ids.has(ends.from.objectId)) ||
    (ends.to.kind === 'attached' && !ids.has(ends.to.objectId))
  );
}

/**
 * Whether one end is drawn stuck to a shape: an end stuck to an object the board
 * no longer holds is drawn as the point it last saw, which is what a free end is,
 * so this says what the arrow looks like rather than what was once written down.
 */
export function endIsAttached(endpoint: ConnectorEndpoint, ids: ReadonlySet<string>): boolean {
  return endpoint.kind === 'attached' && ids.has(endpoint.objectId);
}

/** The boxes and ids a connector read needs, gathered in one walk of the board. */
export function connectorContext(doc: Y.Doc): ConnectorContext {
  const rects = new Map<string, Rect>();
  const ids = new Set<string>();
  getObjects(doc).forEach((map, id) => {
    ids.add(id);
    const rect = rectOfMap(map);
    if (rect !== null) rects.set(id, rect);
  });
  return { rects, ids };
}

/**
 * An object map's box, from the same fields `readObject` reads. A connector has
 * no box of its own — its box is the ends it joins — so it is not in the map of
 * rects, which is also why an arrow never becomes the target of another arrow.
 */
export function rectOfMap(map: unknown): Rect | null {
  if (!(map instanceof Y.Map)) return null;
  if (map.get('type') === 'connector') return null;
  const x = map.get('x');
  const y = map.get('y');
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  const width = map.get('width');
  const height = map.get('height');
  return {
    x,
    y,
    width: typeof width === 'number' && Number.isFinite(width) ? width : 0,
    height: typeof height === 'number' && Number.isFinite(height) ? height : 0,
  };
}

/**
 * Add a connector between two objects (or two points) and return its id.
 *
 * Returns null and writes nothing — no transaction, no update, no undo step —
 * when an end is not an end, when both ends are attached to the same object, or
 * when the line between them is shorter than `CONNECTOR_MIN_LENGTH_WORLD`.
 */
export function createConnector(doc: Y.Doc, creation: ConnectorCreation): string | null {
  const from = readEndpoint(creation.from);
  const to = readEndpoint(creation.to);
  if (from === null || to === null) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  const objects = getObjects(doc);
  const context = connectorContext(doc);
  const ends = resolveConnectorEnds({ from, to }, context.rects);
  if (Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  let top = 0;
  objects.forEach((map) => {
    const value = map.get('z');
    if (typeof value === 'number' && Number.isFinite(value) && value > top) top = value;
  });

  const id = newId();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    // The stored box is the one the ends have at creation; a read recomputes it,
    // so it is never left disagreeing with what is drawn.
    const box = connectorBBox(ends.from, ends.to);
    map.set('type', 'connector');
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('from', endpointToJSON(from));
    map.set('to', endpointToJSON(to));
    map.set('z', top + 1);
    if (creation.createdBy !== undefined && creation.createdBy !== '') map.set('createdBy', creation.createdBy);
    map.set('createdAt', Date.now());
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The connector's own data, read back: its two stored ends, and whether either
 * one points at an object the board has lost. The line geometry lives in the
 * snapshot the board renders; a caller checking an answer wants the ends.
 */
export function readConnector(doc: Y.Doc, id: string): (ConnectorEnds & { id: string; detached: boolean }) | null {
  const map = getObjects(doc).get(id);
  if (!(map instanceof Y.Map) || map.get('type') !== 'connector') return null;
  const from = readEndpoint(map.get('from'));
  const to = readEndpoint(map.get('to'));
  if (from === null || to === null) return null;
  return { id, from, to, detached: connectorIsDetached({ from, to }, connectorContext(doc).ids) };
}

/** Every connector on the board, by id. */
export function listConnectors(doc: Y.Doc): string[] {
  const ids: string[] = [];
  getObjects(doc).forEach((map, id) => {
    if (map instanceof Y.Map && map.get('type') === 'connector') ids.push(id);
  });
  return ids;
}

/**
 * Move one end of a connector, and return true.
 *
 * Returns false, with nothing written, when the connector is gone, when a free
 * end is given something that is not a point, or when an end is attached to the
 * object the *other* end already belongs to — an arrow between a shape and
 * itself has no length, and refusing it is better than drawing a dot.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: ConnectorEnd,
  endpoint: ConnectorEndpoint,
): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (!(map instanceof Y.Map) || map.get('type') !== 'connector') return false;
  // Which of its two ends is meant is not a free-form field name: writing one at
  // a name the object has no place for would be writing a field nothing reads.
  if (end !== 'from' && end !== 'to') return false;

  const from = readEndpoint(map.get('from'));
  const to = readEndpoint(map.get('to'));
  if (from === null || to === null) return false;

  const next = readEndpoint(endpoint);
  if (next === null) return false;

  const other = end === 'from' ? to : from;
  if (next.kind === 'attached' && other.kind === 'attached' && next.objectId === other.objectId) return false;

  doc.transact(() => {
    map.set(end, endpointToJSON(next));
    const ends = resolveConnectorEnds(
      { from: end === 'from' ? next : from, to: end === 'to' ? next : to },
      connectorContext(doc).rects,
    );
    const box = connectorBBox(ends.from, ends.to);
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a connector. False when there is no connector with that id. */
export function deleteConnector(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const map = objects.get(id);
  if (!(map instanceof Y.Map) || map.get('type') !== 'connector') return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Turn every end attached to one of `ids` into a free end at the point its
 * target is currently drawn at, and return the ids of the connectors changed.
 *
 * This runs inside the caller's transaction: a deleted shape and the arrow that
 * was attached to it must be one update and one undo step, so that Undo brings
 * the shape back *and* re-attaches the arrow to it. It has to be done while the
 * target is still there to be looked at, because the side it faces — the point
 * the arrow ends at — stops being knowable the moment it is gone.
 */
export function detachConnectorsTo(doc: Y.Doc, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const objects = getObjects(doc);
  const targets = new Set(ids);
  const context = connectorContext(doc);
  const touched: string[] = [];

  objects.forEach((map, id) => {
    if (targets.has(id)) return;
    if (!(map instanceof Y.Map) || map.get('type') !== 'connector') return;
    const from = readEndpoint(map.get('from'));
    const to = readEndpoint(map.get('to'));
    if (from === null || to === null) return;

    const release = (endpoint: ConnectorEndpoint, other: ConnectorEndpoint): ConnectorEndpoint => {
      if (endpoint.kind !== 'attached' || !targets.has(endpoint.objectId)) return endpoint;
      const anchor = endpointAnchor(endpoint, context.rects, aimOf(other, context.rects));
      return { kind: 'free', x: anchor.x, y: anchor.y };
    };

    const nextFrom = release(from, to);
    const nextTo = release(to, from);
    if (nextFrom === from && nextTo === to) return;
    map.set('from', endpointToJSON(nextFrom));
    map.set('to', endpointToJSON(nextTo));
    touched.push(id);
  });

  return touched;
}

/**
 * Put the free ends of arrows at these points, in one transaction, and write
 * nothing to the ends that are fastened to a shape — a shape is where its own
 * drag puts it, and an arrow's attached end follows from that.
 *
 * This is the statement that moves an arrow, rather than a delta: an arrow has no
 * corner of its own to be moved to, because the box it is drawn in belongs to its
 * ends and, when an end is fastened, to somebody else's shape. So there is no
 * position an arrow can be asked for that says "where the box ought to be" — and a
 * drag, which reports where the pointer has got to rather than how far it came, has
 * to be told in points. Writing the same points again moves nothing the second time,
 * which is the property a drag that fires on every frame needs: the alternative is
 * that a frame which says "the pointer is 60 pixels along" moves the end by 60 every
 * frame it repeats it, and an arrow dragged across a board ends up off the board.
 *
 * Rejects non-finite points with 0 and no transaction.
 */
/** Are two endpoints the same, by reference or by value for free ends? */
function sameEnd(a: ConnectorEndpoint, b: ConnectorEndpoint): boolean {
  if (a === b) return true;
  return a.kind === 'free' && b.kind === 'free' && a.x === b.x && a.y === b.y;
}

export function setConnectorFreeEnds(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { from: Point; to: Point }>,
): number {
  if (positions.size === 0) return 0;
  for (const [, ends] of positions) {
    if (!Number.isFinite(ends.from.x) || !Number.isFinite(ends.from.y)) return 0;
    if (!Number.isFinite(ends.to.x) || !Number.isFinite(ends.to.y)) return 0;
  }
  const objects = getObjects(doc);
  let count = 0;
  doc.transact(() => {
    for (const [id, ends] of positions) {
      const map = objects.get(id);
      if (map === undefined || map.get('type') !== 'connector') continue;
      const from = readEndpoint(map.get('from'));
      const to = readEndpoint(map.get('to'));
      if (from === null || to === null) continue;
      const nextFrom = from.kind === 'free' ? { kind: 'free' as const, x: ends.from.x, y: ends.from.y } : from;
      const nextTo = to.kind === 'free' ? { kind: 'free' as const, x: ends.to.x, y: ends.to.y } : to;
      if (sameEnd(nextFrom, from) && sameEnd(nextTo, to)) continue;
      map.set('from', endpointToJSON(nextFrom));
      map.set('to', endpointToJSON(nextTo));
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * An arrow's whole geometry for a click: whether the point is within the hit
 * tolerance of the line between its two resolved ends. The zoom argument turns
 * the screen-pixel tolerance into board units — an arrow is as easy to hit at
 * 10 % as at 400 %, which is the whole reason it takes one.
 */
export function connectorHitTest(
  snapshot: { resolved: { from: Point; to: Point } },
  point: Point,
  zoom = 1,
): boolean {
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  return distanceToPolyline(point, [snapshot.resolved.from, snapshot.resolved.to]) <= tolerance;
}

/** The box that holds both resolved ends. */
export function connectorBBoxOf(resolved: { from: Point; to: Point }): Rect {
  return connectorBBox(resolved.from, resolved.to);
}

/** Read one connector's snapshot, its ends resolved against the board as it is now. */
export function readConnectorSnapshot(doc: Y.Doc, id: string): ConnectorSnapshot | null {
  const map = getObjects(doc).get(id);
  if (map === undefined) return null;
  const object = readObject(map, id, connectorContext(doc));
  return object !== null && object.type === 'connector' ? object : null;
}
