// Polyline distance (story 10, polyline contract): the distance from a point
// to a polyline, used for connector hit-testing.

import type { Point } from '../geometry';

function distToSegment(a: Point, b: Point, p: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * The minimum distance from `p` to the polyline through `pts` (0 when `p`
 * lies on the line). Empty input: Infinity; a single point: the distance to
 * it.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  const first = pts[0]!;
  if (pts.length === 1) return Math.hypot(p.x - first.x, p.y - first.y);
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    d = Math.min(d, distToSegment(pts[i]!, pts[i + 1]!, p));
  }
  return d;
}
