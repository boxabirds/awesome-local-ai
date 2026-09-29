/**
 * Story 10: distance to a polyline (shared by the connector hit test and,
 * later, the pen story). Pure world-unit math — no doc, no DOM.
 *
 * `distanceToPolyline(pts, p)` is the minimum Euclidean distance from `p`
 * to the polyline: 0 points → Infinity, 1 point → distance to the point,
 * 2+ points → the minimum over all segments (point-to-segment distance).
 */
import type { Point } from '../geometry';

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  // Clamp the projection of (p - a) onto (b - a) to [0, 1].
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let min = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    min = Math.min(min, distToSegment(p, pts[i], pts[i + 1]));
  }
  return min;
}
