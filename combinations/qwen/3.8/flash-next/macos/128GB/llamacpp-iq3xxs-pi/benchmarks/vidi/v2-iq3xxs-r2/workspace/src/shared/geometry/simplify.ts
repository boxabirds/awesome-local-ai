import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';
import { distanceToSegment } from './polyline';

/**
 * The three functions story 11 turns a shaky hand into a stroke with (`stroke.model`):
 *
 * - `simplify` — Ramer–Douglas-Peucker, which is what makes "smoothing stays faithful"
 *   (`pen.smooth`) true: every point the user drew lies within `tolerance` of the line that
 *   comes back, and `tolerance` is `STROKE_SIMPLIFY_TOLERANCE_PX` divided by the zoom the
 *   drawing happened at, i.e. one screen pixel of it.
 * - `splitPoints` — the very-long-stroke rule (`pen.long_stroke`): a long run of recorded
 *   points is cut into parts that share their join point, so consecutive strokes meet with no
 *   gap between them.
 * - `smoothPath` — the SVG path a finished stroke is drawn as: midpoint quadratic curves, which
 *   pass through the middle of every segment and stay inside the hull of the points, so the
 *   rendered line is as faithful as the simplified one.
 *
 * All three are pure and synchronous, and none of them recurses: a stroke is allowed 5,000
 * points, which is far deeper than a call stack should have to be for a feature this small.
 */

/** The points we can work with: finite ones, consecutive duplicates gone. */
function usable(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points ?? []) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = out[out.length - 1];
    // A pointer that reported the same place twice adds nothing to the line, and RDP would
    // treat the zero-length segment as a place where the line changes direction.
    if (last && last.x === point.x && last.y === point.y) continue;
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

/**
 * Drop the points that lie on the line between their neighbours, keeping the result within
 * `tolerance` board units of everything that was drawn.
 *
 * Iterative Ramer–Douglas-Peucker with an explicit stack: mark the point furthest from the
 * chord when it is further than the tolerance and recurse into both halves, otherwise throw the
 * lot away. A tolerance of 0 (or a silly one) keeps every point that is not exactly on the line.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const pts = usable(points);
  if (pts.length <= 2) return pts;
  const toleranceUnits = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;

  const keep: boolean[] = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const spans: [number, number][] = [[0, pts.length - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop()!;
    if (last - first < 2) continue;
    let furthest = -1;
    let furthestDistance = 0;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(pts[first], pts[last], pts[index]);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthest = index;
      }
    }
    if (furthest < 0 || furthestDistance <= toleranceUnits) continue;
    keep[furthest] = true;
    spans.push([first, furthest], [furthest, last]);
  }
  return pts.filter((_, index) => keep[index]);
}

/**
 * Cut a long run of recorded points into parts of at most `max` points, each part starting on
 * the point its predecessor ended on.
 *
 * That shared point is the whole point of the function (`pen.long_stroke`): two consecutive
 * strokes that meet at a point leave no gap between them, so a gesture the length of a spiral
 * still looks like one line. Anything under the limit comes back as a single part, and the
 * limit itself is under the limit — it is the 5,001st point that splits.
 */
export function splitPoints(points: readonly Point[], max = STROKE_MAX_POINTS): Point[][] {
  const pts = usable(points);
  if (pts.length === 0) return [];
  const limit = Number.isFinite(max) && max >= 2 ? Math.floor(max) : 2;
  const parts: Point[][] = [];
  for (let start = 0; start < pts.length; ) {
    const end = Math.min(start + limit, pts.length);
    parts.push(pts.slice(start, end));
    if (end >= pts.length) break;
    // The next part repeats this part's last point, which is where the line carries on.
    start = end - 1;
  }
  return parts;
}

/**
 * The coordinates of a number, written the way JavaScript writes them: as many digits as the
 * number needs and no more, so the same points always produce the same path and a path can be
 * read back into the same numbers.
 */
function at(value: number): string {
  // `Math.fround`-style rounding would be shorter, but it would also make a path that is not
  // the line; the fidelity guarantee is about coordinates, so the coordinates stay exact.
  return String(value);
}

/**
 * The path a stroke is drawn as: through the middle of each segment, with the recorded point as
 * the control point (`M p0 Q p1 mid(p1, p2) Q … L pN`).
 *
 * A path through the midpoints is what makes the rendered line stay where it was drawn: the
 * curve never leaves the hull of the recorded points, and every segment's midpoint is on the
 * curve. A single point is a zero-length path, which a round line cap draws as a dot.
 */
export function smoothPath(points: readonly Point[]): string {
  const pts = usable(points);
  if (pts.length === 0) return '';
  const first = pts[0];
  let d = `M ${at(first.x)} ${at(first.y)}`;
  if (pts.length === 1) return d;
  for (let index = 1; index < pts.length - 1; index += 1) {
    const control = pts[index];
    const next = pts[index + 1];
    d += ` Q ${at(control.x)} ${at(control.y)}`;
    d += ` ${at((control.x + next.x) / 2)} ${at((control.y + next.y) / 2)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${at(last.x)} ${at(last.y)}`;
  return d;
}
