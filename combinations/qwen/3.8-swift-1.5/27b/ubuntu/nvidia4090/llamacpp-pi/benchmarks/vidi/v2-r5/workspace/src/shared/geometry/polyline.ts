// src/shared/geometry/polyline.ts
// Distance from a point to a polyline (sequence of line segments).

import type { Point } from '../geometry';

/**
 * Returns the minimum distance from point `p` to the polyline defined by `pts`.
 * The polyline is the sequence of line segments between consecutive points.
 * If `pts` has fewer than 2 points, returns Infinity.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 2) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(p, pts[i], pts[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Returns the distance from point `p` to the line segment from `a` to `b`.
 */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a === b)
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  // Project p onto the line, clamp t to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}
