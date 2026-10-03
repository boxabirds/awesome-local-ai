/**
 * Geometry for connectors: where an attached end sits on its object, and the box an
 * arrow occupies (story 10).
 *
 * An attached endpoint stores no side — only the object it is attached to. The side, and
 * so the anchor point, is recomputed here from the object's *current* rectangle every time
 * the board is drawn (`connector.follow`). That is what lets an arrow switch sides as an
 * object moves past another, and what lets an arrow follow a move made by somebody else
 * without a single extra write: the rectangle changes, this recomputes, the line moves.
 *
 * Everything is pure and in world units.
 */
import { CONNECTOR_HIT_TOLERANCE_PX } from '../config';
import { distanceToPolyline } from './polyline';
import type { Point, Rect } from '../geometry';

/** Which side of a rectangle a connector attaches to. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Where one end of a connector lives.
 *
 * - `attached` — the end follows the object `objectId`; `fallback` is the anchor point
 *   recorded when it was attached, used only when that object has vanished (a concurrent
 *   delete), so the arrow is always drawn somewhere sensible (`connector.target_deleted`).
 * - `free` — a fixed point on the board, from a drag released over empty space.
 *
 * `Endpoint` is defined with the geometry that resolves it and re-exported from
 * `objects/connector`; both names refer to this one type.
 */
export type Endpoint =
  | { readonly kind: 'attached'; readonly objectId: string; readonly fallback: Point }
  | { readonly kind: 'free'; readonly x: number; readonly y: number };

/** The midpoint of one side of `r` — a point that is on the boundary of a rectangle,
 * an ellipse and a diamond alike, so the same anchor serves every shape kind. */
export function sideAnchor(r: Rect, s: Side): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  switch (s) {
    case 'top':
      return { x: cx, y: r.y };
    case 'bottom':
      return { x: cx, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: cy };
    case 'right':
      return { x: r.x + r.width, y: cy };
  }
}

/**
 * The side of `r` that faces `toward`.
 *
 * A straight line from the centre of `r` to `toward` leaves the rectangle through this
 * side. Comparing `|dx| · height` with `|dy| · width` decides it without trigonometry and
 * handles non-square rectangles: for a square the comparison is `|dx|` against `|dy|`, so
 * the side switches exactly across the 45° diagonal (`connector.follow`, TC-10).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  // Which axis the direction is "more along", measured against the rectangle's own shape.
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  // Screen coordinates grow downward, so a negative `dy` is above, which is the top side.
  return dy >= 0 ? 'bottom' : 'top';
}

/** The point an endpoint stands for when another end needs a direction to face. */
function representativePoint(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  // Attached and present: aim at the object's centre. Attached but gone (orphaned): the
  // stored fallback is the best we have.
  if (rect) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return end.fallback;
}

/** Resolve one endpoint to the world point it is drawn at, facing `toward`. */
function resolveOne(end: Endpoint, toward: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect) return end.fallback; // orphaned: draw at the anchor it was attached at
  return sideAnchor(rect, nearestSide(rect, toward));
}

/** A connector's two endpoints, whatever kind they are, resolved to points. */
export interface ResolvedConnector {
  readonly from: Point;
  readonly to: Point;
}

/**
 * The two points a connector is drawn between, from its endpoints and the current
 * rectangles.
 *
 * Each attached end sits on the side of its object that faces the *other* end; the two are
 * resolved against each object's centre so the calculation does not depend on itself. An
 * attached end whose object is missing draws at its fallback and never throws
 * (`connector.target_deleted`, TC-11). No writes: a remote move changes a rectangle, the
 * snapshot hands us the new one, and the line follows (`connector.follow`).
 */
export function resolveEndpoints(
  c: { readonly from: Endpoint; readonly to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): ResolvedConnector {
  const fromRef = representativePoint(c.from, rects);
  const toRef = representativePoint(c.to, rects);
  return {
    from: resolveOne(c.from, toRef, rects),
    to: resolveOne(c.to, fromRef, rects),
  };
}

/** Is `point` within clicking distance of the arrow drawn between `start` and `end`?
 *
 * The tolerance is `CONNECTOR_HIT_TOLERANCE_PX` in screen pixels, so it is divided by the
 * zoom to become a distance in world units — the closer in you are, the nearer you must
 * click to the line in board terms (`connector.select`, TC-20). The two endpoints are the
 * arrow's already-resolved points. */
export function connectorHitTest(
  arrow: { readonly start: Point; readonly end: Point },
  point: Point,
  zoom: number,
): boolean {
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
  return distanceToPolyline([arrow.start, arrow.end], point) <= tolerance;
}

/** The bounding rectangle of a straight arrow between two points. */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}
