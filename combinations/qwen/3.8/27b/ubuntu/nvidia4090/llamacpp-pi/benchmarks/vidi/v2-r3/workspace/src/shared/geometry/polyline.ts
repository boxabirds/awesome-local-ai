/**
 * Story 10: point-to-polyline distance (world units), reused by story 11.
 * A one-point polyline is a point; an empty polyline is Infinity.
 */
import type { Point } from '../geometry';

/** The distance from `p` to the segment a–b (clamped projection). */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** The minimum distance from `p` to any segment of the polyline. */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i++) {
    d = Math.min(d, distanceToSegment(pts[i], pts[i + 1], p));
  }
  return d;
}
