/**
 * Polyline distance (story 10). Used by connector hit-testing.
 * Reusable by story 11 (freeform pen strokes).
 */
import type { Point } from '../geometry';

/**
 * Minimum distance from point `p` to the polyline defined by `pts`.
 * Returns Infinity for fewer than 2 points.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i], pts[i + 1], p);
    if (d < min) min = d;
  }
  return min;
}

/** Euclidean distance from point `p` to the segment `a`–`b`. */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}
