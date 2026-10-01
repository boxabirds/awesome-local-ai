// Where an arrow's two ends actually are (story 10).
//
// An end is stored as one of two things: attached to an object, or fixed at a
// board point. What it is *drawn at* is never stored. An attached end is drawn at
// the midpoint of the side of its object nearest the other end, worked out from
// wherever that object is now - which is the whole reason an arrow follows a box
// someone else dragged across the board, and why nothing has to be rewritten when
// a box moves.
//
// Screen coordinates throughout, the same y-down system the board itself uses:
// `top` is the smaller y. This is the board's own geometry, no Yjs and no React,
// so it is unit-testable in node at the level of the object model.

import { normalizeRect, type Point, type Rect } from '../geometry.js';

/** An object's four sides, in the order the connection dots are drawn. */
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];

/** One end of an arrow: joined to an object, or pinned to a board point.
 * `fallback` is where an attached end stays if its object is deleted. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface Endpoints {
  from: Endpoint;
  to: Endpoint;
}

/** The board point an end names on its own: its pin, or an attached end's fallback. */
export function endpointPoint(end: Endpoint): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const fallback = end.fallback;
  if (isPoint(fallback)) return { x: fallback.x, y: fallback.y };
  return { x: 0, y: 0 };
}

/** The centre of a rect, the point an end aims at when it points at an object. */
export function centre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The midpoint of one side of a rect: exactly where an attached end is drawn. */
export function sideAnchor(r: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
    default:
      return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * Which side of `r` faces `toward`: the side the arrow will be drawn from.
 *
 * Horizontal wins when the other end is further across than up or down, so the
 * boundary between `right` and `top` is the 45° diagonal through the centre. The
 * comparison is on the board's y-down axes, where the larger of the two distances
 * is the one the arrow leans along.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const middle = centre(r);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/**
 * Where an end is drawn. An attached end whose object is on the board is pinned to
 * the middle of that object's side nearest `toward` - which is the other end; one
 * whose object is gone, deleted or never there, is drawn at its fallback point,
 * which is where it was attached.
 */
export function anchorOf(
  end: Endpoint,
  toward: Point,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return endpointPoint(end);
  const rect = rects.get(end.objectId);
  if (rect === undefined) return endpointPoint(end);
  return sideAnchor(rect, nearestSide(rect, isPoint(toward) ? toward : endpointPoint(end)));
}

/**
 * Both ends, as points. Each end is resolved against the *other* end: whichever
 * end is attached to an object aims that object's nearest side at the other
 * object's centre, so the two ends are decided independently and neither one
 * drags the other's side around as the board moves.
 */
export function resolveEndpoints(
  ends: Endpoints,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: anchorOf(ends.from, aimOf(ends.to, rects), rects),
    to: anchorOf(ends.to, aimOf(ends.from, rects), rects),
  };
}

/** The box an arrow between two points fills: its bounding box, corners included. */
export function connectorBBox(from: Point, to: Point): Rect {
  return normalizeRect(from, to);
}

/** The point an end aims at: the other object's centre, or the other end's point. */
function aimOf(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return endpointPoint(end);
  const rect = rects.get(end.objectId);
  return rect === undefined ? endpointPoint(end) : centre(rect);
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object'
    && value !== null
    && Number.isFinite((value as Point).x)
    && Number.isFinite((value as Point).y)
  );
}
