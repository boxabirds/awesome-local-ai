/**
 * The maths a recorded path goes through before it becomes a stroke (story 11).
 *
 * Three small, pure jobs, and the reason they are pure and shared is that the preview, the
 * stored stroke and the rendering on nine other screens must not each have their own answer:
 *
 *  - {@link simplify} — Ramer-Douglas-Peucker. A mouse or finger reports a point every few
 *    milliseconds, which is hundreds of points for one line, most of them saying the same
 *    thing. Dropping the ones the result already describes is what makes a drawn line come out
 *    smoother than it went in, and the algorithm's guarantee — every dropped point is within
 *    the tolerance of the line that replaces it — is exactly the promise `pen.smooth` makes,
 *    which is why this tolerance-based simplification is used and a fixed stride is not.
 *  - {@link splitPoints} — the limit of `pen.long_stroke`, cutting a path into parts that each
 *    fit, sharing the point at each join so the parts read as one unbroken line.
 *  - {@link smoothPath} — points to an SVG path, drawn through the midpoints so that the
 *    corners of a polyline turn into curves without inventing a point anywhere.
 *
 * Nothing here knows about the document, the camera or the DOM. Tolerances come in as numbers,
 * and the caller — the pen tool, which knows the zoom — is the one that turns screen pixels into
 * board units.
 */

import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';
import { distanceToSegment } from './polyline';

function usable(point: Point | undefined): point is Point {
  return (
    !!point &&
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

/**
 * The path `points` reduced so that every point it dropped lies no farther than `tolerance`
 * from the result — same units in, same units out.
 *
 * The ends are always kept: a stroke finishes where the pen left the board, and a simplification
 * that shaved a few units off the end would be a stroke nobody drew.
 *
 * The recursion is a stack rather than a function, because the longest stroke this app accepts
 * is `STROKE_MAX_POINTS` points and a pathological path (points straying farther and farther
 * from the chord, which is exactly what a spiral is) would otherwise recurse once per point.
 *
 * `tolerance` of 0 or less keeps every point, which is the honest reading of "don't move
 * anything".
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (!Array.isArray(points)) return [];
  const path = points.filter(usable);
  if (path.length < 3) return path.map((point) => ({ x: point.x, y: point.y }));
  const limit = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;

  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;

  // Pairs of kept endpoints still to check. Splitting on the worst offender is the whole
  // algorithm: the point that strays farthest is the one that has to stay, and the two halves
  // either find their own or are already close enough to a straight line.
  const pending: Array<[number, number]> = [[0, path.length - 1]];
  while (pending.length > 0) {
    const span = pending.pop();
    if (!span) continue;
    const [from, to] = span;
    if (to - from < 2) continue;
    const a = path[from];
    const b = path[to];
    let worst = 0;
    let worstAt = -1;
    for (let index = from + 1; index < to; index += 1) {
      const distance = distanceToSegment(a, b, path[index]);
      if (distance > worst) {
        worst = distance;
        worstAt = index;
      }
    }
    if (worstAt < 0 || worst <= limit) continue;
    keep[worstAt] = 1;
    pending.push([from, worstAt], [worstAt, to]);
  }

  const result: Point[] = [];
  for (let index = 0; index < path.length; index += 1) {
    if (keep[index] === 1) result.push({ x: path[index].x, y: path[index].y });
  }
  return result;
}

/**
 * Cut a recorded path into parts of at most `max` points (`pen.long_stroke`).
 *
 * Each part after the first starts with the last point of the part before it. That is not
 * tidiness: two strokes that share their join point draw one unbroken line, while two that
 * simply meet at consecutive points leave a gap the length of one pointer sample, which at speed
 * is visible as a stroke coming apart.
 *
 * A path that fits comes back as one part; an empty one comes back as no parts.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const limit = Number.isFinite(max) && max >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  if (points.length <= limit) return [points.map((point) => ({ x: point.x, y: point.y }))];

  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + limit, points.length);
    parts.push(points.slice(start, end).map((point) => ({ x: point.x, y: point.y })));
    if (end >= points.length) break;
    // The join point belongs to both parts.
    start = end - 1;
  }
  return parts;
}

/** Two decimals is a hundredth of a board unit: below a pixel at any zoom, and short strings. */
function round(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  // So that a path never contains "-0", which is a number that prints differently to 0.
  return rounded === 0 ? 0 : rounded;
}

/**
 * A path through `points`, as SVG path data, with the corners rounded away.
 *
 * The rule is the classic quadratic smoothing of a polyline: run straight to the middle of the
 * first segment, then for every interior point draw a quadratic *through* it — the point itself is
 * the control, and the curve ends at the midpoint towards the next point — and finish with a
 * straight run to the last point. The result passes near, not through, the recorded points, which
 * is what makes a jittery path look drawn rather than plotted, and it reaches both ends the pen
 * actually started and stopped at.
 *
 * Starting at the first midpoint rather than at the first point is not a detail: a chain that
 * begins at the point lets the *first* quadratic span from there to the middle of the second
 * segment, and on a long straight leg — which is exactly what `simplify` leaves behind — that curve
 * bows away from the pen's line by a sizeable fraction of the leg. A straight underline would
 * arrive as a smile.
 *
 * One point is a zero-length subpath, which with a round line cap draws the dot of `pen.dot`.
 * No points is no path at all, and an empty string is what a `<path>` element wants.
 */
export function smoothPath(points: readonly Point[]): string {
  if (!Array.isArray(points)) return '';
  const path = points.filter(usable);
  if (path.length === 0) return '';

  const first = path[0];
  let d = `M ${round(first.x)} ${round(first.y)}`;
  if (path.length === 1) return `${d} L ${round(first.x)} ${round(first.y)}`;

  const second = path[1];
  d += ` L ${round((first.x + second.x) / 2)} ${round((first.y + second.y) / 2)}`;
  for (let index = 1; index < path.length - 1; index += 1) {
    const control = path[index];
    const next = path[index + 1];
    d += ` Q ${round(control.x)} ${round(control.y)} ${round((control.x + next.x) / 2)} ${round((control.y + next.y) / 2)}`;
  }
  const last = path[path.length - 1];
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}
