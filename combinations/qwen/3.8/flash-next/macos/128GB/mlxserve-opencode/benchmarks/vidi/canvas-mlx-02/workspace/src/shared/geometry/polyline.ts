// The polyline distance used for connector hit-testing (story 10, design
// section 3). A hit test against a one-segment arrow is a distance against its
// centre line, so the rule is stated here once, in world units, and both the
// registry's hitTest and the ConnectorTool's hover hit-test call it.
//
// Degenerate inputs total: no points, a missing point, or a non-finite
// coordinate gives Infinity (nothing is ever hit), one point is the distance to
// that point.
import type { Point } from '../geometry.ts';

/** Distance from `p` to the segment `a`..`b` (world units). */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(p.x - a.x, p.y - a.y); // zero-length segment
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Distance from `p` to the polyline through `points` (world units): the minimum
 * over its segments, the distance to the single point for a one-point
 * polyline, Infinity when there is nothing to measure.
 */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (!points || points.length === 0) return Number.POSITIVE_INFINITY;
  if (!isPoint(p)) return Number.POSITIVE_INFINITY;
  if (points.length === 1) {
    const only = points[0];
    return isPoint(only) ? Math.hypot(p.x - only.x, p.y - only.y) : Number.POSITIVE_INFINITY;
  }
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!isPoint(a) || !isPoint(b)) continue;
    min = Math.min(min, distanceToSegment(p, a, b));
  }
  return min;
}

function isPoint(p: Point | undefined | null): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}
