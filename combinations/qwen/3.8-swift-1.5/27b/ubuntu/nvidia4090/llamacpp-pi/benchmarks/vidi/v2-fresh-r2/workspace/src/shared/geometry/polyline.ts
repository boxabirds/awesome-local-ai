/**
 * Pure point/polyline distance geometry (story 10; shared with story 11).
 * No DOM, no Yjs. All values are world (board) units.
 */

import type { Point } from '../geometry';

/** Distance from `p` to a single segment `a`→`b`. */
function distToSegment(a: Point, b: Point, p: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * The shortest distance from point `p` to the polyline through `pts`
 * (the minimum over all its segments). An empty polyline is infinitely far;
 * a single point degenerates to the point distance.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[i + 1], p);
    if (d < min) min = d;
  }
  return min;
}
