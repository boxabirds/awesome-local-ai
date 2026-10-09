import type { Point } from '../geometry';

/**
 * How far `point` is from a polyline — the shortest distance to any of its segments
 * (`connector.select`, and story 11's lasso). `points` with a single entry is a dot, and
 * the distance is to it; no points at all is infinitely far, because nothing is on it.
 *
 * This is the general form of what an arrow needs now: a straight arrow is a polyline of
 * two points, and the freeform line story 11 draws is one of many.
 */
export function distanceToPolyline(points: readonly Point[], point: Point): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  if (points.length === 1) {
    const only = points[0];
    return Math.hypot(only.x - point.x, only.y - point.y);
  }
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    best = Math.min(best, distanceToSegment(from, to, point));
  }
  return best;
}

/**
 * Distance from `point` to the segment `from`–`to`. The closest point is the projection of
 * `point` onto the line the segment lies on, clamped to the segment: without the clamp, a
 * point past the end of the line would be reported as sitting on it (TC-14).
 */
export function distanceToSegment(from: Point, to: Point, point: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  // A degenerate segment (both ends in the same place) is a dot.
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length),
  );
  return Math.hypot(from.x + t * dx - point.x, from.y + t * dy - point.y);
}
