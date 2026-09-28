// Pure polyline distance (story 10; reused by story 11's freehand pen).
// No DOM, no React, no Yjs.

import type { Point } from '../geometry';

/**
 * The shortest distance from point `p` to the polyline `pts` (0 for zero or
 * one points, the point distance for a single point, the minimum
 * point-to-segment distance for 2+ points).
 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Clamp the projection of p onto ab to the segment.
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return 0;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  return min;
}
