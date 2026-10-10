import type { Endpoint } from '../objects/connector';
import type { Point, Rect } from '../geometry';

/**
 * Connector geometry (anchors `connector.endpoints`, `connector.follow`).
 *
 * A connector stores **endpoints**, never resolved coordinates (Key decision 1):
 * these functions are the only place that turns stored endpoints into the points
 * an arrow is drawn to, so a connector can never go out of sync with the object
 * it is attached to.
 *
 * A leaf module: it imports the `Endpoint` **type** from the connector model and
 * nothing else, which is what lets `board-model` derive a connector's bounds
 * without importing the connector model.
 */

/** Which side of an object an endpoint can attach to. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

/** The midpoint of one side of `r` (`connector.endpoints`). */
export function sideAnchor(r: Rect, side: Side): Point {
  const x = finite(r?.x);
  const y = finite(r?.y);
  const width = finite(r?.width);
  const height = finite(r?.height);
  switch (side) {
    case 'top':
      return { x: x + width / 2, y };
    case 'right':
      return { x: x + width, y: y + height / 2 };
    case 'bottom':
      return { x: x + width / 2, y: y + height };
    case 'left':
    default:
      return { x, y: y + height / 2 };
  }
}

/**
 * The side of `r` that faces `toward`.
 *
 * The comparison is aspect-correct: the horizontal distance and the vertical one
 * are each divided by the side they are measured across, so a wide, flat object
 * is entered from its left or right and a narrow, tall one from its top or
 * bottom - which is what makes the arrow land on the side a person aimed at.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const x = finite(r?.x);
  const y = finite(r?.y);
  const width = Math.max(finite(r?.width), Number.MIN_VALUE);
  const height = Math.max(finite(r?.height), Number.MIN_VALUE);
  const dx = finite(toward?.x) - (x + width / 2);
  const dy = finite(toward?.y) - (y + height / 2);
  if (Math.abs(dx) / width > Math.abs(dy) / height) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

/**
 * A first estimate of where an end sits, for the other end to be aimed at.
 *
 * A free end knows its point. An attached end is estimated by the centre of the
 * object it is attached to - which is enough to answer "which way does the other
 * end lie", and it is what the connector model uses when it completes endpoints.
 */
function roughPoint(endpoint: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (!endpoint) {
    return { x: 0, y: 0 };
  }
  if (endpoint.kind === 'free') {
    return { x: finite(endpoint.x), y: finite(endpoint.y) };
  }
  const rect = rects?.get(endpoint.objectId);
  if (!rect) {
    return { x: finite(endpoint.fallback?.x), y: finite(endpoint.fallback?.y) };
  }
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * One stored endpoint, as the point it is drawn to.
 *
 * An attached end has **no side stored** (Key decision 2): the side is whichever
 * side of the object faces the other end right now, so an arrow turns to face the
 * gap it is spanning every time anything moves, with nothing written.
 */
function resolveEndpoint(
  endpoint: Endpoint,
  toward: Point,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (!endpoint) {
    return { x: 0, y: 0 };
  }
  if (endpoint.kind === 'free') {
    return { x: finite(endpoint.x), y: finite(endpoint.y) };
  }
  const rect = rects?.get(endpoint.objectId);
  if (!rect) {
    // The object is gone from this snapshot: the arrow is drawn to the last
    // anchor it had rather than to a made-up point (TC-11).
    return { x: finite(endpoint.fallback?.x), y: finite(endpoint.fallback?.y) };
  }
  return sideAnchor(rect, nearestSide(rect, toward));
}

/**
 * Resolve both endpoints against live rectangles (`connector.follow`).
 *
 * `rects` maps an object id to that object's current rectangle. Each end is
 * placed on the side of its object nearest the other end, computed from these
 * rectangles - not from anything the connector stored - so ends switch sides as
 * objects pass each other. An attached end whose object is missing falls back to
 * its stored anchor and never throws.
 */
export function resolveEndpoints(
  connector: { readonly from: Endpoint; readonly to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromRough = roughPoint(connector?.from, rects);
  const toRough = roughPoint(connector?.to, rects);
  return {
    from: resolveEndpoint(connector?.from, toRough, rects),
    to: resolveEndpoint(connector?.to, fromRough, rects),
  };
}

/** The exact bounding box of the resolved polyline, with no padding. */
export function connectorBBox(from: Point, to: Point): Rect {
  const ax = finite(from?.x);
  const ay = finite(from?.y);
  const bx = finite(to?.x);
  const by = finite(to?.y);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(ax - bx),
    height: Math.abs(ay - by),
  };
}

/** The polyline an arrow is drawn along, in world units. */
export function connectorPolyline(
  connector: { readonly from: Endpoint; readonly to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): readonly Point[] {
  const resolved = resolveEndpoints(connector, rects);
  return [resolved.from, resolved.to];
}
