import type { Endpoint } from "../board-model";
import { CONNECTOR_ARROWHEAD_SIZE_WORLD } from "../config";
import type { Point, Rect } from "../geometry";

/**
 * Connector geometry (`connector.geometry`, story 10).
 *
 * An attached end stores **which object** it is attached to, never which side of
 * it. The side is recomputed here, from the object's *current* rectangle, every
 * time the arrow is drawn — for a move made by this client and for a move made by
 * anybody else in the room, which is the whole of `connector.follows_move` and
 * `connector.follows_remote`: no code has to remember to update an arrow.
 */

export type Side = "left" | "right" | "top" | "bottom";

/** The four sides, in the order a tie between them is decided. */
export const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];

/** An arrow's two ends, as stored. Enough to draw it. */
export interface ConnectorEnds {
  readonly from: Endpoint;
  readonly to: Endpoint;
}

/**
 * The point on `side` of `rect` where an arrow attaches: the midpoint of that
 * side.
 *
 * `sideAnchor(rect, "left")` is `(rect.x, rect.y + rect.height / 2)` — the middle
 * of the left edge, at the rectangle's current x. The board's origin is top-left
 * and y grows downwards, so "top" is the smaller y.
 */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case "left":
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case "right":
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case "top":
      return { x: rect.x + rect.width / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
}

/**
 * The side of `rect` that faces `toward`: the side whose midpoint is nearest
 * `toward`.
 *
 * `toward` is normally the point being faced, and a rectangle is accepted too —
 * its centre is what is faced, which is how the ends of an arrow face each other.
 *
 * Because the four midpoints sit at (+-w/2, 0) and (0, +-h/2) around the centre,
 * two of them are exactly equally far from a target when the target lies on a
 * diagonal from the centre — which is why the switch between `right` and `top`
 * happens at 45 degrees for a square whatever the distance (`connector.switch_side`).
 *
 * Ties keep the order in `SIDES` (`left, right, top, bottom`), so a side is
 * always returned and the line between the objects is never consulted.
 */
export function nearestSide(rect: Rect, toward: Point | Rect): Side {
  const target = facedPoint(toward);
  let best: Side = SIDES[0];
  let bestDistance = Infinity;
  for (const side of SIDES) {
    const anchor = sideAnchor(rect, side);
    const distance = Math.hypot(target.x - anchor.x, target.y - anchor.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = side;
    }
  }
  return best;
}

/** What a faced rectangle or point stands for: a rectangle is faced at its centre. */
function facedPoint(target: Point | Rect): Point {
  const { width, height } = target as Rect;
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { x: target.x + width / 2, y: target.y + height / 2 };
  }
  return { x: target.x, y: target.y };
}

/**
 * Resolves both ends to board points (`connector.geometry`).
 *
 * `rects` maps an object id to that object's **current** rectangle. An attached
 * end whose object is in `rects` anchors on the side of that rectangle facing the
 * other end; an attached end whose object is gone uses the point it was attached
 * to when the arrow was made (`endpoint.fallback`); a free end is its own point.
 *
 * Each end is computed from the *stored* other end — the other object's rectangle
 * when it is known, the other end's own point when it is not — so the two sides
 * never chase each other and the pair is the same whichever order the board was
 * last written in.
 */
export function resolveEndpoints(ends: ConnectorEnds, rects: Map<string, Rect>): { from: Point; to: Point } {
  return {
    from: resolveEnd(ends.from, rects, ends.to),
    to: resolveEnd(ends.to, rects, ends.from),
  };
}

/**
 * One end's anchor, given the other end. Exported because detaching an arrow
 * (`connector.target_deleted`) needs the anchor of the end it is *not* detaching
 * in order to pick the side to detach from.
 */
export function resolveEnd(end: Endpoint, rects: Map<string, Rect>, counterpart: Endpoint): Point {
  if (end.kind === "free") return { x: end.x, y: end.y };

  const rect = rects.get(end.objectId);
  if (rect === undefined) return { x: end.fallback.x, y: end.fallback.y };

  return sideAnchor(rect, nearestSide(rect, facedEnd(counterpart, rects)));
}

/** What an end faces: the other object's rectangle, or the other end's own point. */
function facedEnd(counterpart: Endpoint, rects: Map<string, Rect>): Point | Rect {
  if (counterpart.kind === "attached") {
    const rect = rects.get(counterpart.objectId);
    if (rect !== undefined) return rect;
    return { x: counterpart.fallback.x, y: counterpart.fallback.y };
  }
  return { x: counterpart.x, y: counterpart.y };
}

/**
 * The axis-aligned bounding box of the line between two points, widened by the
 * arrowhead so a horizontal or vertical arrow still has a box the marquee, the
 * selection and the end handles can use.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const pad = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  return {
    x: Math.min(from.x, to.x) - pad,
    y: Math.min(from.y, to.y) - pad,
    width: Math.abs(to.x - from.x) + pad * 2,
    height: Math.abs(to.y - from.y) + pad * 2,
  };
}

/**
 * `distanceToPolyline(points, worldPoint, worldTolerance)` (`connector.select`)
 *
 * The distance from `worldPoint` to the polyline, in board units: the shortest
 * distance to any segment. A caller that wants to know whether a click selects an
 * arrow compares the result with `worldTolerance` (`<=` is a hit), and passes
 * `CONNECTOR_HIT_TOLERANCE_PX / zoom`, which keeps the target the same number of
 * **screen** pixels at every zoom.
 *
 * A single point (a degenerate line) is measured as a point. No points at all is
 * unreachable (`Infinity`). A point exactly `worldTolerance` away is a hit: the
 * boundary is inclusive.
 */
export function distanceToPolyline(points: readonly Point[], worldPoint: Point, worldTolerance: number): number {
  if (!Array.isArray(points) || points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(worldPoint.x - points[0].x, worldPoint.y - points[0].y);

  let best = Infinity;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const distance = distanceToSegment(points[index], points[index + 1], worldPoint);
    if (distance < best) best = distance;
    // Once the tolerance is met nothing further can change the answer.
    if (best <= worldTolerance) return best;
  }
  return best;
}

function distanceToSegment(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
