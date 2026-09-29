// Distance from a point to a polyline — the maths behind "click close enough to an
// arrow to select it" (story 10 `connector.select`) and, later, anything else that
// needs proximity to a stroked path (story 11's pen strokes).
//
// Pure and dependency-free: every distance is in the same units as the points, so
// the caller decides whether it works in screen pixels or board units. The registry
// hit test passes world units and scales its tolerance by the camera zoom.

import type { Point } from '../geometry.ts';

/** Shortest distance from `p` to the segment `a`–`b` (0 when `p` is on it). */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y); // a degenerate segment
  // Clamp the projection parameter to the segment, so points beyond an end measure
  // to that end rather than to the infinite line through it.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Shortest distance from `p` to the polyline through `pts`, or Infinity when there
 * is nothing to measure against. A single point measures to that point.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (!pts || pts.length === 0 || !p) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i], pts[i + 1], p);
    if (d < best) best = d;
  }
  return best;
}
