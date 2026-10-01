/**
 * Distance from a point to a polyline (sequence of line segments).
 * Used by connector hit-testing (story 10) and reused by story 11.
 */
import type { Point } from '../../client/canvas/camera';

/**
 * Minimum Euclidean distance from point `p` to the polyline through `pts`.
 * Returns Infinity when pts has fewer than 2 points (no segments).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i]!, pts[i + 1]!, p);
    if (d < min) min = d;
  }
  return min;
}

/** Distance from point `p` to the segment from `a` to `b`. */
function distToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}
