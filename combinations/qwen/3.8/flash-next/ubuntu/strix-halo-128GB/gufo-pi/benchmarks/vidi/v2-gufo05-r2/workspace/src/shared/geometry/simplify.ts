/**
 * Story 11: turning the points a hand made into a line.
 *
 * A pointer move arrives every few milliseconds, and the path it describes has far more
 * points than the drawing needs and none of the confidence of one. Three small
 * functions stand between the raw gesture and the stroke that gets stored:
 *
 * - `simplify` throws away the points a line could lose without changing, and is
 *   *guaranteed* about it: Ramer–Douglas–Peucker keeps every raw point within
 *   `tolerance` of the path it returns, which is what lets the pen promise that a
 *   smoothed stroke is still the stroke that was drawn (PRD pen.smooth). The tolerance
 *   comes in as screen pixels divided by the zoom, so the promise is made in the units
 *   the eye works in.
 * - `splitPoints` cuts a gesture that has run past the point limit into consecutive
 *   strokes that *share* their join point, so a minute-long scribble is several objects
 *   with no gap between them.
 * - `smoothPath` draws the kept points as a curve rather than a chain of straight
 *   segments: each curve passes through the midpoint of one segment and steers by the
 *   recorded point, which rounds off corners the hand meant to be round without ever
 *   pulling the line more than half a segment away from where it was.
 */

import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/** A point the board can draw: two finite numbers, and nothing else. */
function isFinitePoint(point: Point | undefined | null): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * The finished line: `points` with everything a hand could drop, inside a distance of
 * `tolerance` of what it drew.
 *
 * Iterative rather than recursive, because the point limit is exactly the depth a
 * recursive descent would reach on a path that never deviates: 5,000 nested calls would
 * be the first long stroke anybody drew.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const path = points.filter(isFinitePoint);
  if (path.length < 3) return path;
  // A tolerance that is not a positive number is "keep everything the hand did", which
  // is the safe reading of it: the stroke is still faithful, only longer.
  const toleranceSquared = tolerance > 0 && Number.isFinite(tolerance) ? tolerance * tolerance : 0;
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;

  const pending: [number, number][] = [[0, path.length - 1]];
  while (pending.length > 0) {
    const span = pending.pop()!;
    const from = span[0];
    const to = span[1];
    if (to <= from + 1) continue;
    let worstIndex = -1;
    let worstSquared = -1;
    for (let i = from + 1; i < to; i += 1) {
      const squared = perpendicularDistanceSquared(path[i]!, path[from]!, path[to]!);
      if (squared > worstSquared) {
        worstSquared = squared;
        worstIndex = i;
      }
    }
    // Nothing in between strays further than the tolerance: that whole stretch is one
    // straight run, and every point it held is one the drawing can do without.
    if (worstSquared > toleranceSquared && worstIndex > from) {
      keep[worstIndex] = 1;
      pending.push([from, worstIndex], [worstIndex, to]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < path.length; i += 1) {
    if (keep[i]) out.push(path[i]!);
  }
  return out;
}

/**
 * Squared distance from `p` to the straight line `a` → `b`, measured the way RDP
 * measures it: straight to the line where the line runs past the point, to the nearer
 * end where it does not.
 */
function perpendicularDistanceSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return (p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2;
}

/**
 * Cut a gesture into strokes of at most `max` points, each one starting with the point
 * the one before it ended on.
 *
 * The shared point is the whole of "no visible gap": two strokes that meet at the same
 * board point, drawn with round caps and the same colour and weight, read as one line.
 */
export function splitPoints(points: readonly Point[], max = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  const limit = Number.isFinite(max) && max >= 2 ? Math.floor(max) : 2;
  if (points.length <= limit) return [[...points]];
  const parts: Point[][] = [];
  let from = 0;
  while (from < points.length) {
    const to = Math.min(from + limit, points.length);
    parts.push(points.slice(from, to));
    if (to >= points.length) break;
    // Step back one: the next stroke carries the point this one finished on.
    from = to - 1;
  }
  return parts;
}

/** Two decimal places: enough for a screen, short enough to keep the update small. */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The SVG path that draws `points` as a smooth line.
 *
 * `M` to the first point, then one quadratic curve per recorded point: the point is the
 * curve's control point and the curve lands on the midpoint of the segment after it. A
 * quadratic curve never leaves the triangle of its three points, so the drawn line stays
 * within half a segment of the polyline the simplifier produced — which, together with
 * RDP's own promise, is what keeps the finished stroke inside a screen pixel of the
 * hand-made one at the zoom it was drawn at.
 *
 * One point is a zero-length segment: with a round cap the browser paints that as a
 * dot the width of the pen, which is what a click means.
 */
export function smoothPath(points: readonly Point[]): string {
  const path = points.filter(isFinitePoint);
  if (path.length === 0) return '';
  const first = path[0]!;
  if (path.length === 1) {
    const x = coordinate(first.x);
    const y = coordinate(first.y);
    return `M ${x} ${y} L ${x} ${y}`;
  }
  let d = `M ${coordinate(first.x)} ${coordinate(first.y)}`;
  for (let i = 1; i < path.length - 1; i += 1) {
    const point = path[i]!;
    const landing = mid(point, path[i + 1]!);
    d += ` Q ${coordinate(point.x)} ${coordinate(point.y)} ${coordinate(landing.x)} ${coordinate(landing.y)}`;
  }
  const last = path[path.length - 1]!;
  return `${d} L ${coordinate(last.x)} ${coordinate(last.y)}`;
}
