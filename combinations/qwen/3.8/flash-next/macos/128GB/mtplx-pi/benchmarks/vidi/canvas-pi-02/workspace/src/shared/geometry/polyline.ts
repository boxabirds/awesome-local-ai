/**
 * Polyline distance helpers (reused by story 11).
 *
 * `distanceToPolyline` computes the minimum distance from a point to a
 * polyline (a sequence of at least two points). Used for arrow hit-testing
 * in the connector registry.
 */
import type { Point } from '../geometry';

/** Distance from point `p` to the closest point on segment `a`→`b`. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate segment (a == b): distance to the point itself.
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  // Project p onto the line, clamped to [0, 1].
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Minimum distance from point `p` to the polyline defined by `pts`.
 * Returns Infinity when there are fewer than two points.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i]!, pts[i + 1]!, p);
    if (d < min) min = d;
  }
  return min;
}
