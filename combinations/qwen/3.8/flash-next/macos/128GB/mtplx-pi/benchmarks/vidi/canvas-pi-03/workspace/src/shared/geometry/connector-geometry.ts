// Connector geometry (story 10, contract `connector.model`).
//
// An arrow stores its two ENDS, never a path: the line is derived from the live
// rectangles of whatever it points at, every render. That single decision is
// what makes an arrow follow a box that anyone moves — there is nothing to
// write, so there is nothing to sync or to get out of date.
//
// The `Endpoint` shape lives here (rather than in `objects/connector.ts`) so
// the geometry layer stays free of the document layer: it takes plain points
// and rectangles and is unit-testable with no Y.Doc at all.

import type { Point, Rect } from '../geometry';

/** Which side of a rectangle an arrow attaches to. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The four sides, in clockwise order from the top. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * One end of an arrow.
 *
 * `attached` names an object and keeps a `fallback` point: the anchor where it
 * was attached, used only while that object is missing (deleted here, or
 * deleted by someone else while the arrow was being drawn). `free` is pinned to
 * a board point and never follows anything.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The minimum an arrow renderer needs: its two ends, as stored. */
export interface ConnectorEnds {
  from: Endpoint;
  to: Endpoint;
}

/** The midpoint of a rectangle. */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * The anchor point of one side: its MIDPOINT. Chosen because a side midpoint
 * lies on the boundary of a rect, an ellipse and a diamond alike, so one set of
 * anchors serves all three kinds without a per-kind special case.
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
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
 * The side of `r` nearest `toward`, found by comparing the direction vector
 * from the rectangle's centre against its diagonals.
 *
 * Within ±45° of horizontal the arrow leaves through a left/right side; within
 * ±45° of vertical, through a top/bottom one. Exactly on a diagonal the
 * horizontal answer wins, which keeps the choice total (every point has one
 * side) and stable.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'right';
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The point an end draws at when its object is missing (or is not an object). */
function storedPoint(e: Endpoint): Point {
  return e.kind === 'free' ? { x: e.x, y: e.y } : { x: e.fallback.x, y: e.fallback.y };
}

/** The point an end "points from": the middle of its object, or its own point. */
function towardPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rects.get(e.objectId);
  return rect ? rectCenter(rect) : { x: e.fallback.x, y: e.fallback.y };
}

/**
 * Where the arrow's two ends are right now.
 *
 * Each attached end's side is decided against the OTHER end's centre, so a pair
 * of arrows between the same two boxes can leave through different sides, and
 * both ends move together when either box moves. An attached end whose object
 * is gone draws at its stored `fallback` — an orphaned arrow is still an arrow.
 */
export function resolveEndpoints(
  c: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromRect = c.from.kind === 'attached' ? rects.get(c.from.objectId) : undefined;
  const toRect = c.to.kind === 'attached' ? rects.get(c.to.objectId) : undefined;
  const towardFrom = towardPoint(c.from, rects);
  const towardTo = towardPoint(c.to, rects);
  const from = fromRect ? sideAnchor(fromRect, nearestSide(fromRect, towardTo)) : storedPoint(c.from);
  const to = toRect ? sideAnchor(toRect, nearestSide(toRect, towardFrom)) : storedPoint(c.to);
  return { from, to };
}

/**
 * The footprint of an arrow: the box spanned by its two ends. Derived on every
 * read (never stored), so the marquee, the selection frame and the renderer all
 * agree on where the arrow is without anyone writing it.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}
