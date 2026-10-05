/**
 * Distance to a polyline: the one question a thin object has to be able to answer about a pointer.
 *
 * A sticky note owns a rectangle, so "is the pointer on it" is a box test. An arrow owns a line, which is
 * infinitely thin and impossible to click on, so the question has to be asked differently: how far is this
 * point from the line, so the board can compare the answer with a tolerance. This file answers the distance
 * and nothing else — no tolerance, no zoom, no pixels — because the same arithmetic is what story 11's pen
 * strokes will need for a stroke that can be a hundred segments long, and because the tolerance is a setting
 * that changes with the zoom level while this does not.
 *
 * The maths is the textbook one: for each segment, project the point onto the line, keep the projection
 * inside the segment by clamping its parameter to 0..1 (which is what makes the ends round rather than the
 * line going on forever), and take the smallest distance found. A polyline of one segment is a segment; a
 * polyline of no segments has nothing to be near, and answers infinity — not zero, which would mean every
 * point on the board is on it.
 */
import type { Point } from '../geometry';

/**
 * The distance from `point` to the straight line between `from` and `to`.
 *
 * Clamped, so the distance to a segment is the distance to its nearest *point on it*: a point beyond either
 * end is measured to that end, which is what makes the hit region of a short arrow a fat capsule rather than
 * a slab that runs off past the arrowhead.
 */
export function distanceToSegment(from: Point, to: Point, point: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  // A segment of no length is a dot, and the distance to it is the distance to the dot. Done before the
  // division below, because a division by zero would answer `NaN`, which is not a distance and compares
  // false against everything — a hit test that is never true is the same bug wearing a different hat.
  if (!(lengthSquared > 0)) return Math.hypot(point.x - from.x, point.y - from.y);

  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

/**
 * The distance from `point` to a polyline, the shortest of the distances to its segments.
 *
 * Fewer than two points is not a line. It is not a zero-length line either: `Infinity` is the answer that
 * keeps `distance <= tolerance` false, where `0` would make a two-point stroke that lost one of its points
 * selectible from anywhere on the board.
 */
export function distanceToPolyline(points: readonly Point[], point: Point): number {
  if (!isPoint(point) || !Array.isArray(points) || points.length < 2) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (!isPoint(from) || !isPoint(to)) continue;
    const distance = distanceToSegment(from, to, point);
    if (distance < best) best = distance;
  }
  return best;
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Point).x === 'number' &&
    Number.isFinite((value as Point).x) &&
    typeof (value as Point).y === 'number' &&
    Number.isFinite((value as Point).y)
  );
}
