/**
 * Distance maths for polylines (`connectors.geometry`).
 *
 * Story 7 decided what is under the pointer with axis-aligned boxes, which is the
 * right shape for a note and the wrong shape for an arrow: an arrow is a line, and
 * the box around a diagonal arrow is mostly empty board. Selecting an arrow means
 * asking how far the pointer is from the line, in board units — so this file holds
 * that measurement and nothing else: no document, no React, no DOM, no zoom. The
 * caller divides its screen-pixel tolerance by the zoom before calling
 * (`connector.hit_tolerance_px`), because the only zoom-aware thing about a hit test
 * is the tolerance.
 *
 * Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
 *       (connectors.geometry)
 */
import type { Point } from '../geometry';

/** Straight-line distance between two points. */
export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The closest point to `p` on the segment `a`→`b`, as a point on that segment
 * (`t` clamped to 0…1, so outside the ends it is the nearer end).
 */
export const closestOnSegment = (p: Point, a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  // A degenerate segment is a point: the projection divides by zero.
  if (lengthSq === 0) return { x: a.x, y: a.y };
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
};

/** Perpendicular distance from `p` to the segment `a`→`b` (to either end outside it). */
export const distanceToSegment = (p: Point, a: Point, b: Point): number =>
  distance(p, closestOnSegment(p, a, b));

/**
 * Distance from `p` to the polyline through `points`, in the same units as the
 * points. Zero when `p` is on a vertex; the distance to the single point when the
 * polyline holds one point; Infinity when it holds none, because there is nothing
 * there to hit.
 */
export const distanceToPolyline = (points: readonly Point[], p: Point): number => {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(points[0], p);
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const d = distanceToSegment(p, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
};

/**
 * The unit vector along `from`→`to`, or the origin when the two points are the same
 * (a zero-length segment has no direction, and NaN travelling through a polyline
 * would draw nothing anywhere).
 */
export const unitDirection = (from: Point, to: Point): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };
  return { x: dx / length, y: dy / length };
};
