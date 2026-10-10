import type { Point } from '../geometry';

/**
 * Polyline maths (design "Polyline maths"). A leaf module: pure, no imports but
 * the `Point` type, so anything can use it - an arrow's hit test today, another
 * type's outline tomorrow.
 */

/** Shortest distance from `p` to the segment `a`-`b`, clamped to the segment. */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    // A degenerate segment is a point: measuring it as a line would divide by 0.
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  // Projection of p onto the line, kept inside the segment so the distance to a
  // point beyond its end is the distance to that end (`connector.tolerance`).
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/**
 * Shortest distance from `p` to any segment of the polyline: 0 when the point is
 * on it. An empty polyline is `Infinity`, so it can never be hit.
 */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (!points || points.length === 0 || !p) {
    return Number.POSITIVE_INFINITY;
  }
  if (points.length === 1) {
    return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
  }
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index]!, points[index + 1]!, p);
    if (distance < closest) {
      closest = distance;
    }
  }
  return closest;
}
