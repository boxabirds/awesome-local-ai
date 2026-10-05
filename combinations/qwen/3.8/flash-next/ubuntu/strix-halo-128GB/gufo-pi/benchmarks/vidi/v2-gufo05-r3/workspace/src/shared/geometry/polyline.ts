/**
 * Polyline maths (story 10).
 *
 * A connector is a polyline of two points today; the functions are written for
 * any number of points so the hit test does not have to change when arrows grow
 * elbows. All inputs and outputs are in the same units as the points handed in —
 * the caller converts between screen and world units, because the tolerance a
 * click needs is a fixed number of *screen* pixels.
 */
import type { Point } from '../geometry';

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The distance from `p` to the segment `a`-`b`.
 *
 * A segment of zero length is a point, so its distance is the distance to that
 * point. Any non-finite coordinate gives `Infinity`: a click is never "on" a line
 * whose coordinates are unreadable.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  if (!finite(p?.x) || !finite(p?.y) || !finite(a?.x) || !finite(a?.y) || !finite(b?.x) || !finite(b?.y)) {
    return Number.POSITIVE_INFINITY;
  }
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // How far along the segment the perpendicular from `p` falls, clamped to it:
  // past either end the nearest thing on the line is that end.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * The distance from `p` to the polyline through `pts`.
 *
 * One point is a point; no points is infinitely far away. This is what backs
 * selecting an arrow: `distanceToPolyline(ends, click) <= CONNECTOR_HIT_TOLERANCE_PX / zoom`.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (!Array.isArray(pts) || pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) {
    const only = pts[0];
    if (!finite(only?.x) || !finite(only?.y) || !finite(p?.x) || !finite(p?.y)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.hypot(p.x - only.x, p.y - only.y);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, distanceToSegment(p, pts[i - 1], pts[i]));
  }
  return best;
}
