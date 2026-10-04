import { STROKE_MAX_POINTS } from '../config';
import { distanceToSegment } from './polyline';
import type { Point } from '../geometry';

/**
 * The shape of a captured stroke: what to keep of it, how to break it up, and how to draw what is
 * left (story 11).
 *
 * A pen does not give you a path, it gives you a stream of positions. At 240 Hz a second of drawing is
 * two hundred points, and a stroke that keeps all of them is bigger on the wire, slower to draw and
 * no better looking than the thirty that say the same thing to within a pixel. Everything here is
 * about that reduction, and about the two things it must not cost: the shape of the line, and the
 * join between the pieces of a long one.
 *
 * ```text
 * captured points ──simplify──> kept points ──splitPoints──> parts to commit
 *                                        └──smoothPath──> what is drawn on screen
 * ```
 *
 * Free functions, framework-free and world-agnostic: they are given numbers and hand back numbers, so
 * the same three calls serve the capture (which is in world units), the preview (which is in screen
 * units) and the Durable Object reading a document it did not write.
 */

/** A point that is a place: both coordinates are numbers. */
function isPoint(value: Point | undefined): value is Point {
  return value !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/**
 * Ramer–Douglas–Peucker: the points of `points` that are needed to draw the same line to within
 * `tolerance`, in the order they came.
 *
 * The rule is: keep the two ends, find the point furthest from the straight line between them, and if
 * that distance is more than the tolerance, everything to one side of it and everything to the other
 * get the same question asked of them. A point that is within the tolerance of the line its neighbours
 * define carries no information a straight edge cannot carry, and is dropped.
 *
 * What it guarantees, and what the pen relies on: **every dropped point is within `tolerance` of the
 * kept path**. That is why a tolerance measured in screen pixels is safe ({@link
 * STROKE_SIMPLIFY_TOLERANCE_PX}) - the drawing on the screen cannot change by more than that much -
 * and why the answer never wanders further from the hand than a person was ever shown while drawing.
 *
 * Implemented with an explicit stack rather than recursively on purpose: a stroke of 5000 points is
 * 5000 frames of recursion in the shape the naive version recurses on (a spiral, which is exactly
 * what the tests hand it), and a stack of index pairs does not have that problem.
 *
 * Returns the points it was given, unchanged, when there is no tolerance to simplify with: `0` means
 * "keep everything", not "keep the ends".
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || !Number.isFinite(tolerance) || tolerance <= 0) {
    return [...points];
  }

  const keep: boolean[] = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Pairs of kept indices whose span still has to be examined.
  const spans: [number, number][] = [[0, points.length - 1]];
  while (spans.length > 0) {
    const span = spans.pop();
    if (span === undefined) {
      continue;
    }
    const [start, end] = span;
    if (end - start < 2) {
      continue;
    }

    const from = points[start];
    const to = points[end];
    if (from === undefined || to === undefined) {
      continue;
    }
    let furthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      const away = distanceToSegment(point, from, to);
      if (away > distance) {
        furthest = index;
        distance = away;
      }
    }
    if (furthest === -1) {
      // Every point in between is close enough to the straight edge to be thrown away.
      continue;
    }
    keep[furthest] = true;
    spans.push([start, furthest], [furthest, end]);
  }

  return points.filter((_point, index) => keep[index] === true);
}

/**
 * A path too long for one commit, cut into parts that each fit, joined at a shared point.
 *
 * The joint matters more than the cut. Split 5001 points every 5000 and the naive answer is a part
 * that ends at point 4999 and a part that starts at point 5000: two strokes whose ends are *next to*
 * each other, which draws as a hairline gap at every zoom where the two widths do not overlap, and
 * which is a visible break in a line somebody drew without lifting their hand. Starting each part at
 * the last point of the one before makes the two share that point, so the break cannot appear.
 *
 * Nothing is lost and nothing is reordered: `parts.flat()` is the input with the joints duplicated.
 */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  const limit = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + limit - 1, points.length - 1);
    const part = points.slice(start, end + 1).filter(isPoint);
    if (part.length > 0) {
      parts.push(part);
    }
    if (end === points.length - 1) {
      break;
    }
    // The next part opens where this one closed.
    start = end;
  }
  return parts;
}

/** A number that can go into a path: finite, and short enough to be worth the bytes. */
function coordinate(value: number): string {
  // Three decimals is a thousandth of a world unit; a stroke is never drawn finer than that, and a
  // stored path is smaller for it.
  return String(Math.round(value * 1000) / 1000);
}

/** The point halfway between two others. */
function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * An SVG path through the given points, with the corners taken off by quadratic curves.
 *
 * The construction is the standard one for freehand input, and it exists because captured points are
 * noisy in a way that shows up as *corners*: a hand-drawn line is a few hundred points that each
 * deviate slightly from the direction the line was going, and joined with straight segments that noise
 * reads as a jagged edge. A quadratic curve to the midpoint of each pair, with the point itself as the
 * control point, rounds every join while still passing within a noise-step of every point:
 *
 * ```text
 * M p0  Q p1 mid(p1,p2)  Q p2 mid(p2,p3)  …  L pN
 * ```
 *
 * The path starts and ends on the first and last point, so a stroke finishes where the pen was lifted
 * rather than half a step short of it.
 *
 * One point is drawn as a zero-length segment (`M x y L x y`), which is what a dot is: with round line
 * caps it renders as a dot the width of the stroke, and it is the same path the stroke is stored as.
 * Non-finite points are left out, and a path with nothing left in it is the empty string, which draws
 * nothing rather than `NaN`.
 */
export function smoothPath(points: readonly Point[]): string {
  const path = points.filter(isPoint);
  const first = path[0];
  const last = path[path.length - 1];
  if (first === undefined || last === undefined) {
    return '';
  }
  if (path.length === 1) {
    return `M ${coordinate(first.x)} ${coordinate(first.y)} L ${coordinate(first.x)} ${coordinate(first.y)}`;
  }

  let d = `M ${coordinate(first.x)} ${coordinate(first.y)}`;
  for (let index = 1; index < path.length - 1; index += 1) {
    const point = path[index];
    const next = path[index + 1];
    if (point === undefined || next === undefined) {
      continue;
    }
    const through = middle(point, next);
    d += ` Q ${coordinate(point.x)} ${coordinate(point.y)} ${coordinate(through.x)} ${coordinate(through.y)}`;
  }
  return `${d} L ${coordinate(last.x)} ${coordinate(last.y)}`;
}
