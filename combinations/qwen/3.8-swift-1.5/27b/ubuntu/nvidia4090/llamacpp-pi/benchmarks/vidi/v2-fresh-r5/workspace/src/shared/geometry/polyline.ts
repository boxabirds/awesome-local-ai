/**
 * Pure polyline geometry helpers. No DOM, no React imports.
 */
import type { Point } from '../geometry';

/**
 * Compute the minimum distance from point `p` to the polyline defined by `pts`.
 * The polyline is a sequence of line segments connecting consecutive points.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) {
    return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  }

  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const dist = distanceToSegment(pts[i], pts[i + 1], p);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (point)
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  // Project p onto the line, clamp t to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}
