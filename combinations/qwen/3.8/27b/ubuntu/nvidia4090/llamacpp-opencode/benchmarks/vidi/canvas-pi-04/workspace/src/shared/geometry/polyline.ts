// Story 10: polyline distance (anchor: connector.hit).
//
// The shared helper for the screen-space hit tolerance around the arrow body:
// the shortest distance from a point to a polyline, in the same units as the
// input (world units here; divide by zoom for screen px).

import type { Point } from '../geometry';

function segmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * The shortest distance from `p` to the polyline `pts` (0 when `p` lies on a
 * segment, Infinity for an empty polyline, the point distance for a single
 * vertex).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segmentDistance(p, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
}
