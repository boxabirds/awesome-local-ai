/**
 * Distance from a point to a polyline.
 *
 * This is the whole of what story 10 needs to answer "did that click land on the arrow?", and it is
 * deliberately written as a plain function of points and not as a method on a connector: a line that a
 * person can click is the only line there is on this board, and story 11's freehand stroke is a
 * polyline of two hundred points in exactly the same sense. The one file keeps the two answers from
 * disagreeing about how near is near.
 *
 * Everything here is in world units, which matters more than it sounds: the tolerance a person feels is
 * in *screen* pixels, so whoever calls this has already divided the pixel figure by the zoom. That
 * division belongs to the caller, because the caller is the one who knows what zoom is being drawn at —
 * and a distance function that quietly knew about zoom would be wrong the moment somebody rotated the
 * board.
 */

import type { Point } from '../geometry';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Is this a place, as opposed to a hole in a document? */
const isPoint = (value: unknown): value is Point => {
  if (value === null || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return finite(point.x) && finite(point.y);
};

/** The distance from `point` to the single place `spot`. */
const toPoint = (spot: Point, point: Point): number => Math.hypot(spot.x - point.x, spot.y - point.y);

/**
 * The distance from `point` to the straight run between `a` and `b`.
 *
 * The projection parameter is clamped rather than tested against the segment's endpoints with a pair of
 * corner checks: `t = 0` and `t = 1` *are* the endpoints, so clamping answers the "beyond the end of the
 * line" case with the same arithmetic as the "opposite the middle" one and cannot get the boundary
 * between them wrong by an epsilon.
 */
const toSegment = (a: Point, b: Point, point: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  if (squared === 0) return toPoint(a, point); // a segment with no length is a point
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
  return Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
};

/**
 * How far `point` is from the line that runs through `points`, in world units.
 *
 * Zero is on the line. An empty list is as far away as it is possible to be, which compares false
 * against any tolerance — so a connector whose ends have both gone missing is unclickable rather than
 * clickable from anywhere, which is the direction a mistake here should go in.
 *
 * A point in the list that is not a point is skipped rather than poisoning the answer with NaN. The
 * lonely ones — an end at either side of a hole — still count as places, so a line with a gap in it is
 * clickable near where it still exists instead of nowhere at all.
 */
export function distanceToPolyline(points: readonly Point[], point: Point): number {
  if (!Array.isArray(points) || !isPoint(point)) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const here = points[index];
    const next = points[index + 1];
    if (isPoint(here) && isPoint(next)) {
      best = Math.min(best, toSegment(here, next, point));
    } else if (isPoint(here)) {
      // Either the last point of all, or one whose neighbour is a hole: either way there is no line to
      // walk from here, and the distance to a place is the distance to it.
      best = Math.min(best, toPoint(here, point));
    }
  }
  return best;
}
