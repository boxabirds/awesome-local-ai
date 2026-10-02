// Turning a lot of points into a line worth keeping.
//
// A pen stroke is a transcript of a pointer: a hundred numbers a second, most of
// which say nothing a neighbour has not already said. Three things are done to
// that transcript here and all three are maths with a promise attached, which is
// why they are one module rather than three functions wherever they were needed:
//
//   `simplify` throws points away and promises that what it drew is never further
//   from the path the hand took than the tolerance it was given;
//
//   `splitPoints` cuts a path too long to store as one object into lengths that
//   fit, and promises that the pieces still draw the whole path, because they
//   overlap at the point where the cut was made;
//
//   `smoothPath` turns points into the SVG path they will be painted as, and
//   promises that the curve it draws stays among the points it was handed.
//
// None of it knows about Yjs, about the document or about what a stroke is: it is
// the same arithmetic whether the points came from a pen, a mouse or a document
// that somebody else wrote.

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker: the fewest points that stay within `tolerance` of the
 * path through `points`.
 *
 * The guarantee it is used for here is the one RDP is actually built on: every
 * point it drops lies within `tolerance` of the polyline that survives, so a
 * simplified stroke is never further from the line the pointer took than the
 * tolerance the tool asked for — one screen pixel at the zoom it was drawn at.
 *
 * The first and last points are always kept: a stroke begins where the pointer
 * went down and ends where it came up, and tidying is nobody's business but that.
 *
 * Written with a stack of ranges rather than by calling itself, because the
 * longest stroke the product allows is `STROKE_MAX_POINTS` points and a recursive
 * simplifier would be a simplifier that threw on a stroke it was built for.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const count = points.length;
  if (count < 3) return [...points];
  // No tolerance is not "as tidy as possible", it is "tidy nothing": a negative or
  // missing one returns the drawing exactly as it was made.
  if (!(tolerance > 0)) return [...points];

  const squared = tolerance * tolerance;
  const keep: boolean[] = new Array<boolean>(count).fill(false);
  keep[0] = true;
  keep[count - 1] = true;

  // The farthest point from the chord, and how far: the point RDP keeps, if there
  // is one far enough away to be worth keeping.
  let top = 0;
  const start: number[] = new Array<number>(count);
  const end: number[] = new Array<number>(count);
  start[top] = 0;
  end[top] = count - 1;

  while (top >= 0) {
    const from = start[top]!;
    const to = end[top]!;
    top--;
    if (to <= from + 1) continue;

    let worst = squared;
    let at = -1;
    for (let index = from + 1; index < to; index++) {
      const off = squaredDistance(points[index]!, points[from]!, points[to]!);
      if (off >= worst) {
        worst = off;
        at = index;
      }
    }
    if (at === -1) continue; // every point in the range is inside the tolerance

    keep[at] = true;
    top++;
    start[top] = from;
    end[top] = at;
    top++;
    start[top] = at;
    end[top] = to;
  }

  const result: Point[] = [];
  for (let index = 0; index < count; index++) {
    if (keep[index]) result.push(points[index]!);
  }
  return result;
}

/**
 * The square of the distance from `point` to the segment `from`–`to`, in the same
 * units as the squared tolerance it is compared against.
 *
 * Squared throughout, so the only square root a simplification takes is one nobody
 * asked for. A segment of no length — two points drawn on top of each other, which
 * a pointer that paused will produce — is answered by the distance to that point.
 */
function squaredDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  if (!(squared > 0)) return (point.x - from.x) ** 2 + (point.y - from.y) ** 2;
  const t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared;
  const foot = t < 0 ? 0 : t > 1 ? 1 : t;
  return (point.x - (from.x + foot * dx)) ** 2 + (point.y - (from.y + foot * dy)) ** 2;
}

/**
 * Cut a path into lengths of at most `max` points, for a store that cannot hold a
 * longer one.
 *
 * The pieces overlap by their join: each part after the first begins with the last
 * point of the part before it. That is the whole reason this is not a plain
 * `chunk` — two strokes drawn one after the other with a point between them leave a
 * gap on the board the size of that point, and a stroke that reached its limit was
 * not meant to leave one. Rejoining the parts the other way round, dropping the
 * repeated point from every part but the first, gives back the path that went in.
 *
 * A path that fits comes back as a single part, and the boundary is tested on both
 * sides of it: `max` points is one part, `max` + 1 is two.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  // A limit below two points would be a limit that keeps no path at all, since a
  // part has to hold both the point it starts at and the one it goes to.
  const limit = max >= 2 ? Math.floor(max) : points.length;
  if (points.length <= limit) return [[...points]];

  const parts: Point[][] = [];
  let from = 0;
  while (from < points.length - 1) {
    const to = Math.min(from + limit, points.length);
    parts.push(points.slice(from, to) as Point[]);
    // The next part starts at this part's last point, not after it.
    from = to - 1;
  }
  return parts;
}

/**
 * The SVG path the pen stroke is painted with: quadratic curves that pass through
 * the midpoint of every pair of points, so the line is rounded at each one instead
 * of cornered at it.
 *
 * It is a plain function of its points and nothing else — no clock, no random
 * number, no rounding that depends on the machine — because the same stroke has to
 * be painted with the same path on every screen that reads it, and two screens that
 * drew one stroke differently would be two people looking at two boards.
 *
 * Each curve's control point is a drawn point and each of its endpoints is either a
 * drawn point or the midpoint of two of them, so the curve never leaves the points
 * it was handed. That is the second half of how a finished stroke stays faithful to
 * the hand: `simplify` keeps the points within a tolerance of the drawing, and this
 * draws among those points.
 *
 * The last leg is a straight `L` to the final point rather than a curve: the stroke
 * ends where the pointer came up, and a curve that stopped at the midpoint before it
 * would leave the last half-segment of somebody's drawing undrawn.
 */
export function smoothPath(points: readonly Point[]): string {
  const count = points.length;
  if (count === 0) return '';
  const first = points[0]!;
  // A path of no length, which a round line cap paints as a dot the size of the
  // pen: what a press and a release with nothing between them drew.
  if (count === 1) return `M${coord(first)}L${coord(first)}`;

  let path = `M${coord(first)}`;
  // One curve per drawn point but the first and the last: each leaves the midpoint
  // before its point and runs to the midpoint after it, so the point is the control
  // that bends the line rather than a corner it turns.
  for (let index = 1; index + 1 < count; index++) {
    const control = points[index]!;
    path += `Q${coord(control)} ${coord(midpoint(control, points[index + 1]!))}`;
  }
  return `${path}L${coord(points[count - 1]!)}`;
}

/** `x,y`, with no formatting that could differ between one engine and another. */
function coord(point: Point): string {
  return `${point.x},${point.y}`;
}

/** Halfway between two points, in both directions. */
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
