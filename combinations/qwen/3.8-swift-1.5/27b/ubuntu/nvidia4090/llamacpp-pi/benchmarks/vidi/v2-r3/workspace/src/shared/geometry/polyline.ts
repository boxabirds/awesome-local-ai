import type { Point } from '../geometry';

/**
 * Compute the minimum distance from point `p` to a polyline defined by the
 * ordered list of points `pts`. For a single segment, this is the distance
 * to the line segment. For multiple segments, the minimum over all segments.
 *
 * Returns 0 if `pts` has fewer than 2 points.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 2) return 0;
  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(p, pts[i], pts[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Distance from point `p` to the line segment from `a` to `b`.
 */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a === b): distance to point a
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  // Project p onto the line, clamp t to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}
