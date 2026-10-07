/**
 * Where an arrow attaches to a box (`connector.model`).
 *
 * An attached arrow end stores *no side*: the side is recomputed from the
 * object's current rectangle every time the board is rendered, which is the
 * whole reason an arrow follows the box it was drawn to and switches to the
 * nearer side when the box is dragged past it (`connector.follow`) - there is
 * nothing to write, so there is nothing for the sync layer to fall behind on.
 *
 * The three pieces of maths:
 *
 * - {@link nearestSide} - which of the four sides faces the other end, decided by
 *   comparing the direction to the box's own diagonals, so a wide box and a tall
 *   box switch sides at their own 45-degree line;
 * - {@link sideAnchor} - the midpoint of a side, which is the one point that lies
 *   on the boundary of a rectangle, an ellipse *and* a diamond, so one anchor
 *   serves every kind;
 * - {@link resolveEndpoints} - the two points to draw between, from the stored
 *   endpoints and the current rectangles.
 *
 * No Yjs, no React, no DOM: the model, the client and the tests all call these
 * same functions, so what a test proves is what gets drawn.
 */

import type { Point, Rect } from '../geometry.js';
/** The four sides of a rectangle. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** One end of an arrow: pinned to an object, or pinned to a point on the board. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Which end of the arrow. */
export type ConnectorEnd = 'from' | 'to';

/** The centre of a rectangle. */
export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * The midpoint of one side. It is on the boundary of a rectangle, of an ellipse
 * and of a diamond, which is why the board can have one anchor rule for every
 * kind of shape: the arrow meets the shape at the place all three agree on.
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

/** The four sides, in the order a person reading a compass would list them. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** One of the four connection points, named by the side it sits on. */
export type SideMiddle = { side: Side; x: number; y: number };

/**
 * The four connection points of a box: the middle of each side, each carrying the
 * side it is on. The Connector tool shows these while the pointer is over an object
 * (`connector.hover_points`) and highlights the one an arrow would use, which is
 * {@link sideAnchor} of {@link nearestSide} - the same point the arrow is drawn at
 * once it is attached, so the dot promises exactly what the arrow does.
 */
export function sideMiddles(r: Rect): SideMiddle[] {
  return SIDES.map((side) => ({ side, ...sideAnchor(r, side) }));
}

/**
 * Which of an object's four sides faces `toward`.
 *
 * The direction from the object's centre to the point is compared with the
 * object's own diagonals: the point is nearer the left/right edge when it lies
 * between them, and nearer the top/bottom edge otherwise. Comparing
 * `|dx| * height` with `|dy| * width` is the same test without an atan2 or a
 * divide, so a tall box and a wide box each turn at their own 45-degree line
 * (`connector.follow`: an arrow that used to leave the right edge comes out of
 * the bottom as the other object is dragged around it).
 *
 * Exactly on the diagonal counts as horizontal, which is a choice and not a law;
 * what matters is that it is the same choice on every screen.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const centre = rectCentre(r);
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const horizontal = Math.abs(dx) * r.height >= Math.abs(dy) * r.width;
  if (horizontal) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The two ends of an arrow, as geometry needs them. */
export type ConnectorEnds = { from: Endpoint; to: Endpoint };

/**
 * Where one end is drawn, given the rectangles of the objects on the board.
 *
 * A free end is the point it stores. An attached end is the middle of the side of
 * its object that faces the *other* end - facing it by way of the other object's
 * centre, so that neither end has to know the other's anchor first and the two
 * never chase each other into a different answer on each screen. An attached end
 * whose object is not on the board is drawn at its stored `fallback`: the arrow is
 * orphaned, not missing (`connector.target_deleted`, including the race in which
 * the other person deletes the object as this end is being attached).
 */
export function endpointPoint(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rects.get(e.objectId);
  if (rect === undefined) return { x: e.fallback.x, y: e.fallback.y };
  const toward =
    other.kind === 'free'
      ? { x: other.x, y: other.y }
      : (rects.get(other.objectId) === undefined
          ? other.fallback
          : rectCentre(rects.get(other.objectId)!));
  return sideAnchor(rect, nearestSide(rect, toward));
}

/** The two points an arrow is drawn between, from its ends and the live rectangles. */
export function resolveEndpoints(
  c: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: endpointPoint(c.from, c.to, rects),
    to: endpointPoint(c.to, c.from, rects),
  };
}

/**
 * The smallest rectangle around an arrow's two points. A straight arrow is a line
 * and a line has no area: an arrow that runs perfectly vertically has a box of no
 * width, which is honest - the selection outline of an arrow is the box its line
 * lives in, and nothing more.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
