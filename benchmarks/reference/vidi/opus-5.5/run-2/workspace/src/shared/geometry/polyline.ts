/**
 * Distance from a point to a polyline (anchor: connector.select; reused by story 11's pen
 * strokes). World units, pure.
 */
import type { Point } from '../geometry';

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from `p` to any segment of `pts`; a single point is a point; empty is Infinity. */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i += 1) best = Math.min(best, distanceToSegment(pts[i - 1]!, pts[i]!, p));
  return best;
}
