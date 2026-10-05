import type { Point } from '../geometry';

/**
 * The minimum distance from point `p` to the polyline defined by the sequence
 * of points `pts`. For a single point, returns the distance to that point.
 * For an empty array, returns Infinity.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return distanceToSegment(p, pts[0], pts[0]);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(p, pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** The minimum distance from point `p` to the line segment from `a` to `b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a === b)
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  // Project p onto the line through a and b, clamped to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}
