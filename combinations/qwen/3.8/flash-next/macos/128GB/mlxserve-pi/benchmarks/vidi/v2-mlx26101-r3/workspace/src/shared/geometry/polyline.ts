import type { Point } from '../geometry';

/**
 * The distance from a point to a straight line segment, in the same units as the points.
 *
 * `t` is where along the segment the closest point is, clamped to the segment itself: before its
 * start (t = 0) or past its end (t = 1) the closest point on the *segment* is that end, not the
 * point the infinite line would pass through. Without the clamp, clicking just past the head of a
 * short arrow would measure the distance to a line that is not drawn there.
 *
 * A segment of no length - both ends the same point - divides by zero, so it is answered directly:
 * the distance to the point.
 */
export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  if (squared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * The distance from a point to a polyline: the closest of its segments, or `Infinity` when there is
 * nothing to be close to.
 *
 * Story 10 uses it to answer "was this arrow clicked?" for an object that is a line and not a box -
 * a hit that cannot be a bounding box, because the box around a diagonal arrow is mostly empty board
 * (see `ConnectorObject`). Story 11's pen draws polylines and will ask the same question of a stroke
 * with a hundred points in it, which is the reason this lives in `shared` and knows nothing about
 * either of them.
 *
 * Fewer than two points is not a line: no points give `Infinity`, so a caller comparing against a
 * tolerance gets a clean "no", and one point gives its own distance, which is the answer for a stroke
 * somebody tapped once.
 */
export function distanceToPolyline(points: readonly Point[], point: Point): number {
  const only = points.length === 1 ? points[0] : undefined;
  if (only !== undefined) {
    // One point is not a line, but it is somewhere, and a click on it is a click on it.
    return Math.hypot(point.x - only.x, point.y - only.y);
  }
  let closest = Infinity;
  let previous: Point | null = null;
  for (const current of points) {
    if (previous !== null) {
      closest = Math.min(closest, distanceToSegment(point, previous, current));
    }
    previous = current;
  }
  return closest;
}
