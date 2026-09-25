/**
 * Distance from a point to a polyline (story 10 arrow hit testing; story 11 reuses it for pen
 * strokes). World units, pure.
 */
import type { Point } from '../geometry';

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Projection of p onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Shortest distance from `p` to the polyline through `pts` (ends included, so the ends are
 * round). Infinity for an empty polyline; a single point gives the distance to it.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) best = Math.min(best, distanceToSegment(pts[i - 1]!, pts[i]!, p));
  return best;
}
