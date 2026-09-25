/**
 * Pure polyline distance helpers (story 10, connector.select; shared with
 * story 11).
 *
 * All values are world units. Functions are pure and total.
 */

import type { Point } from '../../client/canvas/camera';

/**
 * Shortest distance from point `p` to the polyline defined by the ordered
 * vertices `pts`. For an empty polyline returns `Infinity`; for a single
 * point, the distance to that point.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(pts[0]!.x - p.x, pts[0]!.y - p.y);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i]!, pts[i + 1]!, p);
    if (d < min) min = d;
  }
  return min;
}

/** Shortest distance from point `p` to segment `a`–`b`. */
function distToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(a.x - p.x, a.y - p.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(projX - p.x, projY - p.y);
}
