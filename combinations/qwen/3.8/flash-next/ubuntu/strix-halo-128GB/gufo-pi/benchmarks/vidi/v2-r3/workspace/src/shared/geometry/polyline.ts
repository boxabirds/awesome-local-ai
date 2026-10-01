/**
 * Polyline distance utility (story 10, reused by story 11).
 * All values in world units.
 */
import type { Point } from '../geometry';

/**
 * Compute the minimum distance from point `p` to a polyline defined by `pts`.
 * For a single-point polyline, returns the distance to that point.
 * For an empty polyline, returns Infinity.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);

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

  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  // Parameter along segment, clamped [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}
