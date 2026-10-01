import type { Point } from '../geometry';

/**
 * Compute the shortest distance from a point `p` to a polyline defined by `pts`.
 * Returns Infinity for empty or single-point polylines.
 *
 * Used for connector hit-testing (distance from click to arrow line).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 2) return Infinity;

  let minDist = Infinity;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = distanceToSegment(a, b, p);
    if (d < minDist) minDist = d;
  }

  return minDist;
}

/**
 * Shortest distance from point `p` to line segment `ab`.
 */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate: a and b are the same point
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Parameter t: projection of p onto ab, clamped to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const ex = p.x - projX;
  const ey = p.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}
