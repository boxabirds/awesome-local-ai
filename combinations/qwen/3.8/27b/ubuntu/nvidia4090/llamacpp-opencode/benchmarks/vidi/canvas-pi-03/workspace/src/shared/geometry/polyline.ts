import type { Point } from '../geometry';

/**
 * Point/polyline distance helpers (story 10). Shared with the pen strokes
 * of story 11 (the same hit test applies: distance to the centerline).
 */

/**
 * Distance from `p` to segment `a`-`b` (clamped projection: the distance to
 * the nearest endpoint when the projection falls outside the segment).
 */
export function pointToSegment(p: Point, a: Point, b: Point): number {
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

/** Distance from `p` to the polyline (minimum over all segments). */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = pointToSegment(p, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}
