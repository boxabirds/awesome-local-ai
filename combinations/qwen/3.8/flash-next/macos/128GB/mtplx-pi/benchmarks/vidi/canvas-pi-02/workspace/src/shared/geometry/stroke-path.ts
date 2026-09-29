/**
 * The shape stroke ink occupies (design §2.2, §3.3).
 *
 * A stroke is a polyline drawn `strokeWidth` wide, so what it covers is the
 * envelope of that polyline — never its enclosed area. A stroke has no fill
 * (`fillPaint` is false for every pen stroke), so the inside of a ring or of a
 * self-crossing figure stays empty, which is what the PRD's drawing rule asks
 * for: a stroke that closes is a *closed stroke*, not a shape.
 *
 * The envelope is kept as the polyline's own segments and tested with a
 * distance-to-segment check, which is all `hitTestStroke` needs.
 */
import type { Point } from '../geometry';
import { distanceToPolyline, distanceToSegment } from './polyline';

export interface StrokeGeometry {
  /** The centreline actually drawn: the stored points, closed if closed. */
  skeleton: Point[];
  /** That polyline as pairs, which is what both the renderer and the hit test walk. */
  segments: [Point, Point][];
  /** The first place the skeleton crosses itself, or null. */
  selfCrossed: Point | null;
  /** Whether a world point falls on the ink. */
  contains(point: Point): boolean;
}

/** The segments of a polyline: n-1, plus the closing one when it is closed. */
export function polylineSegments(
  points: readonly Point[],
  closed = false,
): [Point, Point][] {
  const segments: [Point, Point][] = [];
  if (points.length < 2) return segments;
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i]!, points[i + 1]!]);
  }
  if (closed && points.length >= 3) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) segments.push([last, first]);
  }
  return segments;
}

function samePoint(p: Point, q: Point): boolean {
  return p.x === q.x && p.y === q.y;
}

/**
 * Where two segments cross, or null.
 *
 * A shared end point is not a crossing — a polyline that comes back to where
 * it started is a ring, not a knot.
 */
function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const cross = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (!(d1 * d2 < 0 && d3 * d4 < 0)) return null;
  if (samePoint(a, c) || samePoint(a, d) || samePoint(b, c) || samePoint(b, d)) return null;
  const t = d1 / (d1 - d2);
  const u = d3 / (d3 - d4);
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** The first place the polyline crosses itself, or null. */
export function strokeSelfIntersection(points: readonly Point[]): Point | null {
  const segments = polylineSegments(points, true);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      // The closing join is not a crossing, and neither is a plain neighbour.
      if (i === 0 && j === segments.length - 1) continue;
      const first = segments[i]!;
      const second = segments[j]!;
      const cross = crossing(first[0], first[1], second[0], second[1]);
      if (cross) return cross;
    }
  }
  return null;
}

/** The point's distance to the polyline, or Infinity when there is none. */
export function distanceToStroke(points: readonly Point[], point: Point): number {
  return distanceToPolyline(points, point);
}

/** Whether a point lies within `epsilon` of the polyline. */
export function isPointWithin(
  point: Point,
  points: readonly Point[],
  epsilon: number,
): boolean {
  return distanceToStroke(points, point) <= epsilon;
}

/**
 * The ink of a stroke: its skeleton, drawn `width` wide (`segmentStroke`).
 *
 * `closed` closes the skeleton so a ring's ink joins up. The enclosed area is
 * deliberately not part of it, because a stroke has no fill; a self-crossing
 * stroke is still only its envelope, which is why `selfCrossed` is reported
 * rather than folded into `contains`.
 */
export function segmentStroke(
  points: readonly Point[],
  width: number,
  closed = false,
): StrokeGeometry {
  const skeleton = [...points];
  if (closed && skeleton.length >= 3) {
    const first = skeleton[0]!;
    const last = skeleton[skeleton.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) skeleton.push({ ...first });
  }
  const segments = polylineSegments(points, closed);
  const half = width / 2;
  if (points.length === 1) {
    // A dot: the pen's ink is one point, and one point covers a disc. There is
    // no segment to walk here, so a `contains` that only walked segments would
    // say a dot is nowhere — the thing that was just drawn could not be clicked.
    const dot = points[0]!;
    return {
      skeleton,
      segments: [],
      selfCrossed: null,
      contains(point: Point): boolean {
        return Math.hypot(point.x - dot.x, point.y - dot.y) <= half;
      },
    };
  }
  return {
    skeleton,
    segments,
    selfCrossed: strokeSelfIntersection(points),
    contains(point: Point): boolean {
      for (const [a, b] of segments) {
        if (distanceToSegment(a, b, point) <= half) return true;
      }
      return false;
    },
  };
}
