import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';

/**
 * Where an arrow's end is fastened (story 10).
 *
 * The four states the product has are two in this type, because "orphaned" and "detached" are not
 * kinds of endpoint - they are what an `attached` endpoint looks like when the object it names is
 * no longer on the board. That is the whole of why they need no separate state, and no migration,
 * and no repair: an endpoint that names a deleted shape is still exactly the endpoint that was
 * written, and the only thing that changed is what the lookup finds, which is nothing.
 *
 * - `attached`: fastened to an object. The end is *recomputed from that object's box every time the
 *   board is drawn*, so an arrow follows a shape that anybody moved without anything having to be
 *   written. `fallback` is the point the end was at when it was written, and is what the end is
 *   drawn at when its object is gone - the arrow keeps the shape it had, rather than jumping to the
 *   origin or vanishing.
 * - `free`: a point on the board. Nothing to follow.
 *
 * `fallback` is required on an attached end on purpose. An endpoint written without one is not an
 * endpoint with a missing detail, it is an endpoint that cannot be drawn at all once its object is
 * deleted, and `readEndpoint` rejects it rather than inventing (0, 0) for it.
 */
export type Endpoint =
  | { readonly kind: 'attached'; readonly objectId: string; readonly fallback: Point }
  | { readonly kind: 'free'; readonly x: number; readonly y: number };

/** Which end of a connector is being talked about. */
export type End = 'from' | 'to';

export const ENDS: readonly End[] = ['from', 'to'];

/**
 * The four sides of a box, in the order a hover shows their anchors: clockwise from the top.
 *
 * A side, not a corner, because the midpoint of a side is the one point that lies on the boundary
 * of all three kinds the product draws - rectangle, ellipse and diamond - so an arrow fastened to
 * it touches the shape it is attached to whether that shape is a box, an oval or a diamond.
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The point in the middle of one side of a box, in world units. */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

/**
 * Which side of `rect` faces `point`.
 *
 * The comparison is with the box's diagonals, and it is a multiply rather than an `atan2`: the
 * boundary between "the side I am on" and "the top or bottom I am on" is the line through the centre
 * at the box's own proportions, so `|dx| / width` against `|dy| / height` says it - cross-multiplied
 * so a box of zero width cannot divide. Exactly on that line the vertical sides win, which is the
 * same answer as a square at 45 degrees gives on either side of it.
 *
 * A point inside the box answers too (the side its pointer is nearest), which is what a connector
 * dragged from inside a shape needs: there is no such thing as an arrow that starts inside a shape
 * and points at nothing.
 */
export function nearestSide(rect: Rect, point: Point): Side {
  const dx = point.x - (rect.x + rect.width / 2);
  const dy = point.y - (rect.y + rect.height / 2);
  if (Math.abs(dx) * rect.height >= Math.abs(dy) * rect.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/** A finite point, or nothing. */
function asPoint(value: unknown): Point | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = record.x;
  const y = record.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

/**
 * An endpoint read out of whatever the document holds.
 *
 * Returns `null` for anything that is not an endpoint - an unknown `kind`, an id that is not a
 * string, a point with a `NaN` in it - and the caller decides what an unreadable end means. It is
 * not a default, because an arrow cannot have its end quietly moved to the origin of the board:
 * both places that draw an arrow drop the object instead (see `asConnectorSnapshot`), so a
 * half-written connector is a connector that is not drawn rather than an arrow pointing at (0, 0).
 */
export function readEndpoint(value: unknown): Endpoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'free') {
    const point = asPoint(record);
    return point === null ? null : { kind: 'free', x: point.x, y: point.y };
  }
  if (record.kind === 'attached') {
    if (typeof record.objectId !== 'string' || record.objectId === '') {
      return null;
    }
    const fallback = asPoint(record.fallback);
    return fallback === null ? null : { kind: 'attached', objectId: record.objectId, fallback };
  }
  return null;
}

/**
 * An endpoint as it is written to the document: a plain JSON object in the connector's `Y.Map`.
 *
 * A nested object rather than a `Y.Map` of its own because an endpoint is never edited in place -
 * it is replaced whole when it is re-attached, and the merge behaviour of a separate `Y.Map` would
 * be a *worse* answer there: two people moving the two ends of one arrow must not have a point that
 * is half from one write and half from the other.
 */
export function endpointValue(endpoint: Endpoint): Record<string, unknown> {
  return endpoint.kind === 'free'
    ? { kind: 'free', x: endpoint.x, y: endpoint.y }
    : { kind: 'attached', objectId: endpoint.objectId, fallback: endpoint.fallback };
}

/**
 * Where an endpoint is on the board, given the boxes that are on it now.
 *
 * `aim` is the point the end is pointing at - the other end, as the caller knows it (see
 * {@link endpointAim}). It is a parameter rather than something looked up here because the side a
 * shape presents is a fact about *both* ends, and this function is handed one of them.
 */
export function endpointPoint(
  endpoint: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  aim?: Point,
): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  const rect = rects.get(endpoint.objectId);
  // No box means the object is gone - deleted, or not in this snapshot yet, which is what a board
  // looks like in the moment before somebody else's delete arrives. The point it was written at is
  // the point it stays at: the arrow keeps its shape instead of moving or disappearing, and there is
  // nothing to repair, because if the object comes back (an undo, a peer's still-open copy) the end
  // fastens to it again by itself.
  if (rect === undefined) {
    return endpoint.fallback;
  }
  return sideAnchor(rect, nearestSide(rect, aim ?? endpoint.fallback));
}

/**
 * What an endpoint is aiming at: the centre of the object at the other end, that end's own point when
 * it is free, or the point it was written at when its object is gone.
 *
 * The centre rather than the other end's *anchor*, to break a circle: an anchor is chosen from an aim,
 * and the aim would be an anchor, so two ends fastened to two shapes would each be decided by where the
 * other one is decided - a sum with no answer of its own. Centres are decided by the two boxes alone,
 * which is also the one thing always true about them: an arrow drawn between two shapes goes between
 * the two shapes.
 */
export function endpointAim(endpoint: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  const rect = rects.get(endpoint.objectId);
  if (rect === undefined) {
    return endpoint.fallback;
  }
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The two ends of a connector, before they have been looked up. */
export interface ConnectorEnds {
  readonly from: Endpoint;
  readonly to: Endpoint;
}

/**
 * Where a connector's two ends are *now*.
 *
 * The whole of "arrows follow what they are attached to" is this one pure function, called whenever
 * the board is drawn: both ends are looked up in the boxes that exist at this moment, so a shape
 * that anybody moved or resized - this client, a peer, an undo - takes its arrows with it, and
 * nothing is written, so there is no arrow position that could be out of date.
 *
 * An end fastened to an object that is not in `rects` stays where it was written (see
 * {@link endpointPoint}), which is why the function never throws on a board that has changed
 * underneath it.
 */
export function resolveEndpoints(
  ends: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: endpointPoint(ends.from, rects, endpointAim(ends.to, rects)),
    to: endpointPoint(ends.to, rects, endpointAim(ends.from, rects)),
  };
}

/** The box an arrow is drawn in: the two ends, corner to corner. */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** The point an end would be fastened to on an object, given the point it is aimed at. */
export function attachEndpoint(objectId: string, aim: Point, rect: Rect): Endpoint {
  return { kind: 'attached', objectId, fallback: sideAnchor(rect, nearestSide(rect, aim)) };
}

/** The end that is not the one being changed. */
export function otherEnd(end: End): End {
  return end === 'from' ? 'to' : 'from';
}

/**
 * Whether a connector of this length would be drawn.
 *
 * The length that matters is the length *after* the ends have been looked up, which is why the
 * caller hands in resolved points rather than endpoints: two ends fastened to the same object are
 * never 8 units apart however far apart the pointer was, and an arrow 3 pixels long is an arrow
 * nobody can find with a cursor afterwards.
 */
export function isConnectorLongEnough(from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) >= CONNECTOR_MIN_LENGTH_WORLD;
}
