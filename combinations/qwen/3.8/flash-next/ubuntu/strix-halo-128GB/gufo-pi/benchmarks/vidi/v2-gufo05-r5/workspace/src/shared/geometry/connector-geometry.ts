/**
 * Where an arrow's ends are drawn (story 10).
 *
 * An attached end names an object, not a point: the line is resolved from that object's rectangle
 * every frame, which is what makes an arrow follow the shape it was drawn to. The side it leaves
 * from is the one nearest the other end - a direction test bounded by the rectangle's own
 * diagonals - so no side ever needs storing, and two screens that agree about the rectangles agree
 * about the arrow without exchanging a single extra number.
 */
import type { Point, Rect } from '../geometry';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../config';
import type { Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of one side. */
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
 * The side of `rect` that faces `toward`.
 *
 * The four diagonals of the rectangle divide the plane into four cones, one per side; the
 * direction from the centre to `toward` lies in exactly one of them. Comparing `|dy| * width`
 * with `|dx| * height` asks which cone it is without dividing, and reduces to the familiar
 * 45 degrees for a square.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const dx = toward.x - (rect.x + rect.width / 2);
  const dy = toward.y - (rect.y + rect.height / 2);
  if (Math.abs(dy) * rect.width <= Math.abs(dx) * rect.height) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy <= 0 ? 'top' : 'bottom';
}

/** The part of a connector the endpoints are resolved from: its two ends, and nothing else. */
export type ConnectorEnds = { readonly from: Endpoint; readonly to: Endpoint };

/** Where an end is drawn: the anchor of its object, or the point it was left at. */
function pointOf(end: Endpoint, toward: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  // An object that is not on the board any more is drawn where it was last seen (story 10's
  // delete race: an arrow that arrives while its target is being deleted is not thrown away).
  if (!rect) return { x: end.fallback.x, y: end.fallback.y };
  return sideAnchor(rect, nearestSide(rect, toward));
}

/**
 * Where a connector's two ends are drawn right now.
 *
 * Each end points at the other. For an attached end the direction is taken to the *centre* of the
 * object at the other end rather than to its own anchor: the anchor of one end would otherwise
 * depend on the anchor of the other, and a pair that depends on itself has no answer. The centre
 * is the same information, and it picks the same side for every shape but the degenerate.
 */
export function resolveEndpoints(
  connector: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const targetOf = (end: Endpoint): Point => {
    if (end.kind === 'free') return { x: end.x, y: end.y };
    const rect = rects.get(end.objectId);
    return rect
      ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      : { x: end.fallback.x, y: end.fallback.y };
  };
  return {
    from: pointOf(connector.from, targetOf(connector.to), rects),
    to: pointOf(connector.to, targetOf(connector.from), rects),
  };
}

/**
 * True when a pointer at `point` (world units) counts as a click on the arrow drawn between `ends`,
 * given the board `zoom`.
 *
 * The tolerance is a number of pixels on screen, because that is what a person's aim is measured
 * in; the distance is in world units, because that is what the board is measured in. Multiplying by
 * the zoom converts the second into the first, so an arrow is exactly as easy to catch when the
 * board is zoomed out as it is when it is zoomed in.
 */
export function hitConnector(
  ends: { readonly from: Point; readonly to: Point },
  point: Point,
  zoom: number,
  toleranceScreenPx: number = CONNECTOR_HIT_TOLERANCE_PX,
): boolean {
  const distance = distanceToSegment(point, ends.from, ends.to);
  return distance * (zoom > 0 ? zoom : 1) <= toleranceScreenPx;
}

/** The distance from a point to a segment, with the projection clamped to the segment itself. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + clamped * vx), p.y - (a.y + clamped * vy));
}

/** The smallest axis-aligned box covering both ends. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}
