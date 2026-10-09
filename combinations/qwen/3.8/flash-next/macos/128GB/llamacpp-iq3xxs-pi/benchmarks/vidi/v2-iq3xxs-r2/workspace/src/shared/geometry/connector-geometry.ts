import type { Point, Rect } from '../geometry';
import type { ConnectorEnds, Endpoint } from '../objects/connector';

/**
 * Where an arrow meets an object (story 10): the four side midpoints. A connector's ends
 * are not free-floating points but places on the boundary of what they point at, and only
 * four of them are ever chosen — this is the whole vocabulary of "which side".
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The four sides, in the order a ring around an object goes clockwise from the top. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * The midpoint of `side` of `rect`, on the boundary itself — which is also the middle of
 * that side of an ellipse's box and of a diamond (whose points are exactly the midpoints
 * of its bounding box), so one function places the ends of every shape this board draws.
 */
export function sideAnchor(rect: Rect, side: Side): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  switch (side) {
    case 'top':
      return { x: cx, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: cy };
    case 'bottom':
      return { x: cx, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: cy };
  }
}

/**
 * Which side of `rect` faces `toward` (TC-10): the direction from the rect's centre to
 * the point is compared with the rect's diagonals, so the side changes exactly at the
 * diagonal of the box — 45° for a square, and steeper or flatter for a box that is wider
 * than it is tall.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const halfWidth = Math.max(rect.width, 0) / 2;
  const halfHeight = Math.max(rect.height, 0) / 2;
  const dx = toward.x - (rect.x + rect.width / 2);
  const dy = toward.y - (rect.y + rect.height / 2);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'right';
  // How far the point is from the centre in each direction, measured in half-sides: the
  // two are equal exactly along the diagonals, which is where the side changes. A box
  // with no width has no side to leave from except top and bottom, and that falls out of
  // measuring in half-sides as well.
  const across = halfWidth > 0 ? Math.abs(dx) / halfWidth : 0;
  const down = halfHeight > 0 ? Math.abs(dy) / halfHeight : 0;
  if (across > down) return dx > 0 ? 'right' : 'left';
  if (down > 0) return dy > 0 ? 'bottom' : 'top';
  // Dead centre: every side is equally near, and one of them has to answer for it.
  return 'right';
}

/**
 * Where an arrow's two ends actually are, given where the objects it joins currently are
 * (`connector.follow`). Both ends are recomputed: the side an end sits on is the one
 * nearest the *other* end, so moving one object can move the anchor on the other one too.
 *
 * An end attached to an object that is not in `rects` — deleted, or deleted by somebody
 * else while this client was drawing (TC-11, TC-27) — is drawn at the fallback point
 * stored with the end instead, and never throws. Nothing is written: this is asked again
 * on every snapshot, which is why an arrow follows a move without any extra work.
 */
export function resolveEndpoints(
  connector: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: anchorFor(connector.from, referenceFor(connector.to, rects), rects),
    to: anchorFor(connector.to, referenceFor(connector.from, rects), rects),
  };
}

/**
 * The point an end is pointing at: the middle of the object at the other end if that
 * object is there, and its own point (a free end, or the fallback of an end whose object
 * has gone) if it is not.
 */
function referenceFor(endpoint: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
  const rect = rects.get(endpoint.objectId);
  if (!rect) return { ...endpoint.fallback };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Where an end sits: on the side of its object that faces `other`, or at its own point. */
function anchorFor(endpoint: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
  const rect = rects.get(endpoint.objectId);
  if (!rect) return { ...endpoint.fallback };
  return sideAnchor(rect, nearestSide(rect, other));
}

/**
 * The box that contains an arrow's two ends: what the selection outline, the marquee and
 * story 7's generic move code use as an object's bounds. A straight line has no area, so
 * a horizontal arrow has a box of height 0 — the selection box may be a line, and that is
 * honest.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** The distance between an arrow's two ends, which is what its "too short to be an arrow"
 * rule measures. */
export function connectorLength(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}
