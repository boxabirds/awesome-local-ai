/**
 * Story 10: distance from a point to a polyline (sequence of points).
 * Used for connector hit-testing. Reused by story 11.
 */
import type { Point } from '../geometry';

/**
 * Minimum distance from point `p` to the polyline defined by `pts`.
 * A polyline with fewer than 2 points returns the distance to the first
 * point (or Infinity if empty).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y);

  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Distance from point `p` to line segment `a`-`b`.
 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;

  if (lenSq === 0) return Math.hypot(apx, apy);

  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * abx;
  const projY = a.y + t * aby;

  return Math.hypot(p.x - projX, p.y - projY);
}
