// Distance from a point to a polyline: the geometry a thin object is selected
// by, and the reason it is shared.
//
// A connector (story 10) is one segment and a pen stroke (story 11) is a
// hundred, and both are clicked by asking the same question — how far is this
// point from this line? A selection that asked it twice would give two answers
// to the same click.
import type { Point } from '../geometry';

/**
 * The shortest distance from `point` to the polyline through `points`.
 *
 * A single point has no line near it, so the distance to itself is its distance
 * to that point; a one-point polyline is the whole question by itself. Segments
 * whose length is not a finite number are skipped, so a polyline built out of
 * something that went wrong in a document cannot become `NaN` and then be near
 * everything, which is how a stroke that cannot be picked selects everything.
 */
export function distanceToPolyline(point: Point, points: readonly Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(point, points[0]!);

  let best = Infinity;
  for (let index = 0; index + 1 < points.length; index++) {
    const span = segmentDistance(point, points[index]!, points[index + 1]!);
    if (span < best) best = span;
  }
  // A polyline of points that are all unusable is the one-point case by another
  // name, and answers the same way.
  return Number.isFinite(best) ? best : distance(point, points[0]!);
}

/** The distance from `point` to one segment. */
export function distanceToSegment(point: Point, start: Point, end: Point): number {
  return segmentDistance(point, start, end);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The perpendicular distance, or the distance to the nearer end when the foot of
 * the perpendicular falls outside the segment.
 *
 * The projection parameter is divided by the squared length, so a zero-length
 * segment — which a drag that went nowhere, or a document that lost a number,
 * can produce — is answered by the distance to the point rather than by a
 * division that would say `NaN`.
 */
function segmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  if (!(squared > 0)) return distance(point, start);
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared;
  const foot = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(point.x - (start.x + foot * dx), point.y - (start.y + foot * dy));
}
