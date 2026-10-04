/**
 * Story 10: how far a point is from a polyline.
 *
 * An arrow is a line of one or more segments (a straight arrow is one, an elbow
 * arrow will be two) drawn inside the bounding box of its two ends. Clicking it
 * has to mean "close to the line", not "inside that box", so both the selection
 * rule and the arrow tool ask this one function how far the pointer is from the
 * line — in board units, which is why the screen-pixel tolerance is divided by
 * the zoom before it comes here.
 */

import type { Point } from '../geometry';

/**
 * Distance from `p` to the segment `a` → `b`.
 *
 * The closest point is the foot of the perpendicular whenever that falls between
 * the ends; at the two extremes it is the nearer end instead, which is what makes
 * the distance grow smoothly past a short segment instead of jumping.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // How far along the segment the perpendicular foot lies, clamped to it.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Distance from `p` to the polyline through `points`.
 *
 * An empty list has no line at all, so the answer is Infinity rather than a
 * number a click could accidentally satisfy. One point is treated as a dot.
 */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const distance = distanceToPolylineSegment(p, points[i - 1], points[i]);
    if (distance < best) best = distance;
  }
  return best;
}

function distanceToPolylineSegment(p: Point, a: Point, b: Point): number {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    // A broken end (a document that arrived with rubbish in it) is skipped
    // rather than poisoning every distance with NaN.
    return Infinity;
  }
  return distanceToSegment(p, a, b);
}

/** The bounding box of a set of points, as a rect. */
export function polylineBounds(points: readonly Point[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
