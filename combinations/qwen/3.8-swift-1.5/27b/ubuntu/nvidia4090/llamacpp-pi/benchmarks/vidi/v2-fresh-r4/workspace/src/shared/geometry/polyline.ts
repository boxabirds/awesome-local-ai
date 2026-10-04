/**
 * Pure polyline distance (story 10; reused by story 11's freehand pen):
 * the minimum distance from a point to any segment of a polyline.
 */
import type { Point } from '../geometry';

/**
 * Distance from `p` to the polyline `pts` (0 for a point on any segment,
 * the distance to the nearest endpoint beyond the segments). Infinity for an
 * empty polyline.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distanceToSegment(pts[i], pts[i + 1], p));
  }
  return best;
}

/** Distance from point `p` to segment `a`–`b`. */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
