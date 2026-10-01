// The geometry a freehand stroke is drawn with (story 11): the simplification
// that decides how many points a line keeps, the split that keeps one gesture
// inside one stroke's point cap, and the path the renderer draws.
//
// All three exist because a Pen drag samples a point every frame of a pointer's
// movement and that is far more than a board should store: a two-second scribble
// is thousands of points, most of them on a straight run that two points already
// describe. `simplify` is Ramer-Douglas-Peucker - it throws away the points that
// are on the line between their neighbours, and keeps a point only where the line
// actually bends, which is what leaves a drawing that looks like the hand-drawn
// one instead of a polyfill of it.
//
// The two halves of that promise are checked against each other in
// tests/unit/stroke.test.ts: the smaller the point count gets, the further each
// raw point may have drifted - and `tolerance` is exactly that distance, so the
// test measures every raw point against the result and says so.
//
// Board units throughout; no Yjs, no DOM. `tolerance` is a board-unit length the
// caller got by dividing a screen-pixel setting by the zoom.

import { STROKE_MAX_POINTS } from '../config.js';
import type { Point } from '../geometry.js';

function isFinitePoint(value: unknown): value is Point {
  return (
    typeof value === 'object'
    && value !== null
    && Number.isFinite((value as Point).x)
    && Number.isFinite((value as Point).y)
  );
}

/**
 * Ramer-Douglas-Peucker: the polyline through `points` that keeps a point only
 * where the line bends more than `tolerance` away.
 *
 * The first and last points always survive - the pen went down there and lifted
 * there, and a drawing that lost its ends is not the same drawing - and every
 * point that is dropped is within `tolerance` of the line that replaced it, which
 * is the whole of what "the line is still the line" means. A tolerance of 0 (or a
 * negative or unusable one) drops nothing.
 *
 * Iterative rather than recursive on purpose: a gesture runs to
 * `STROKE_MAX_POINTS` points, and the worst case for this algorithm's depth is one
 * split per point, which is a stack frame per point a browser would not forgive.
 * Ties go to the first point to earn its place, so the result is one answer and
 * not whichever of two the walk happened to find first.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const pts: Point[] = [];
  for (const point of points) if (isFinitePoint(point)) pts.push(point);
  if (pts.length < 3) return pts;

  const tolerance2 =
    Number.isFinite(tolerance) && tolerance > 0 ? tolerance * tolerance : -1;
  if (tolerance2 < 0) return pts; // no tolerance to spend: every point stays

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const spans: number[][] = [[0, pts.length - 1]];
  while (spans.length > 0) {
    const span = spans.pop()!;
    const first = span[0]!;
    const last = span[1]!;
    if (last - first < 2) continue;

    // The point furthest from the chord, in the order the pen drew them.
    const a = pts[first]!;
    const b = pts[last]!;
    let far = -1;
    let farIndex = -1;
    for (let i = first + 1; i < last; i += 1) {
      const p = pts[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      // The square of the distance to the chord: the same comparison without the
      // square root, because this runs over every point of every stroke.
      const d =
        lengthSq === 0
          ? (p.x - a.x) ** 2 + (p.y - a.y) ** 2
          : (() => {
              const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
              const cx = a.x + t * dx;
              const cy = a.y + t * dy;
              return (p.x - cx) ** 2 + (p.y - cy) ** 2;
            })();
      if (d > far) {
        far = d;
        farIndex = i;
      }
    }

    if (farIndex < 0 || far <= tolerance2) continue; // the chord is close enough
    keep[farIndex] = 1;
    spans.push([first, farIndex], [farIndex, last]);
  }

  const kept: Point[] = [];
  for (let i = 0; i < pts.length; i += 1) if (keep[i] === 1) kept.push(pts[i]!);
  return kept;
}

/**
 * The parts a gesture of more than `max` points is stored as: chunks of `max`,
 * each next part beginning at the point the previous one ended at, so the line
 * is never broken - only told twice. A gesture at or under the cap is one part; a
 * gesture with no usable points is no parts.
 *
 * The shared point is what makes two strokes read as one line: part 2's first
 * point *is* part 1's last, so the two paths meet at the same place on the board.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const pts: Point[] = [];
  for (const point of points) if (isFinitePoint(point)) pts.push(point);
  if (pts.length === 0) return [];

  // A cap of one point could not share an end with anything, so an unusable cap
  // means "no split" rather than a loop that never ends.
  const cap = Number.isInteger(max) && max >= 2 ? max : pts.length;
  if (pts.length <= cap) return [pts];

  const parts: Point[][] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + cap, pts.length);
    parts.push(pts.slice(start, end));
    if (end >= pts.length) return parts;
    start = end - 1;
  }
}

/**
 * A path as short as it can be without lying about the line: numbers are written
 * to three decimals, which is a thousandth of a board unit - a hundredth of the
 * width of a hair at 400% zoom, and a tenth of the drawing tolerance.
 */
function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * The path a stroke is drawn as: the points it was given, drawn as a curve rather
 * than as the straight jumps between them.
 *
 * Each point becomes the *control* point of a quadratic segment whose end is the
 * midpoint of it and the next, so the curve always passes through the midpoint of
 * two neighbours and never further from a straight run than half the step that got
 * it there. That is what stops a simplified line reading as a polygon: a hand that
 * turned a corner drew a corner, and a corner is what shows.
 *
 * A single point is drawn as a zero-length line, which is what a round line cap
 * draws as a dot - a tap with the Pen is a stroke, not nothing. No points is an
 * empty string, so a renderer that gets nothing draws nothing.
 */
export function smoothPath(points: readonly Point[]): string {
  const pts: Point[] = [];
  for (const point of points) if (isFinitePoint(point)) pts.push(point);
  if (pts.length === 0) return '';

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (pts.length === 1) return `M ${n(first.x)} ${n(first.y)} L ${n(first.x)} ${n(first.y)}`;
  if (pts.length === 2) return `M ${n(first.x)} ${n(first.y)} L ${n(last.x)} ${n(last.y)}`;

  let d = `M ${n(first.x)} ${n(first.y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    d += ` Q ${n(p.x)} ${n(p.y)} ${n((p.x + q.x) / 2)} ${n((p.y + q.y) / 2)}`;
  }
  return `${d} L ${n(last.x)} ${n(last.y)}`;
}
