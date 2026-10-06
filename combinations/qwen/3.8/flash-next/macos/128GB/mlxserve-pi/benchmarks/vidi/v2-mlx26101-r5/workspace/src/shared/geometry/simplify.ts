/**
 * Simplification and smoothing of pointer paths (story 11).
 *
 * A pen does not produce a line, it produces a recording of a hand: two hundred events a second, most of
 * them a millimetre from the one before. The first job here is to notice which of those events the shape
 * actually needs, the second is to decide what to do with the ones that are left over when there are more
 * than a document should hold, and the third is to say how a list of points becomes something a browser
 * can draw that does not look like a list of points.
 *
 * The algorithm is Ramer–Douglas–Peucker, and the reason it is the right one is that it is the only one
 * here that can be *asked* for a guarantee and be checked against it. A tolerance in is a promise out: no
 * point that was thrown away is farther from the kept line than that tolerance. RDP delivers it exactly —
 * it keeps the point that is farthest from the line it is holding, so the farthest discarded point is
 * necessarily the next one down, and the recursion stops as soon as a stretch lies wholly inside the
 * corridor. Smoothing by averaging or by sampling gives a nicer-looking line, and no way to answer the
 * question "how wrong is it", which is a question the PRD asks in so many words.
 */

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/** Twice the perpendicular distance from `b` to the line `a`–`c`, which is the area of the triangle twice over. */
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** The perpendicular distance from `point` to the *line* through `a` and `b`, unbounded by the segment. */
function perpendicularDistance(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // With no direction to measure against, the distance is to where the line is, which is where `a` is: the
  // endpoints are always kept anyway, so this case never costs anything.
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs(cross(a, b, point)) / length;
}

/**
 * The points of `points` between `from` and `to`, excluding both ends, marked as needed.
 *
 * `from` and `to` are indices the caller has already decided to keep. A point is kept when the farthest
 * point in the stretch either is inside the tolerance — in which case the straight run stands for all of
 * them — or is not, in which case it is kept and the two stretches on either side of it get the same
 * question asked of them.
 */
function mark(points: readonly Point[], keep: boolean[], from: number, to: number, tolerance: number): void {
  if (to <= from + 1) return; // nothing between them to decide about

  let farthest = -1;
  let distance = -1;
  const a = points[from] as Point;
  const b = points[to] as Point;
  for (let index = from + 1; index < to; index += 1) {
    const candidate = perpendicularDistance(a, b, points[index] as Point);
    if (candidate > distance) {
      distance = candidate;
      farthest = index;
    }
  }

  // The comparison is against the tolerance and not above it: a point exactly on the edge of the corridor
  // is inside it, and a test that asserts "within 1" holds.
  if (distance <= tolerance || farthest === -1) return;

  keep[farthest] = true;
  mark(points, keep, from, farthest, tolerance);
  mark(points, keep, farthest, to, tolerance);
}

/**
 * Throw away the points the shape does not need, keeping the shape.
 *
 * `tolerance` is in world units, which at the zoom the stroke was drawn at is the same number of screen
 * pixels the setting names: a stroke drawn at 200 % is smoothed to half a world unit, because a pixel is
 * half as much board down there. A tolerance that is not a number, or is negative, keeps everything —
 * points are not thrown away on the strength of a measurement that failed.
 *
 * The first and the last points always survive. A stroke whose ends moved would be a sketch that shrinks
 * every time the board tidies it up, and it is where the pen touched down and lifted off, which a person
 * would notice.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  if (!Number.isFinite(tolerance) || tolerance < 0) return points.map((point) => ({ ...point }));

  const keep: boolean[] = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  mark(points, keep, 0, points.length - 1, tolerance);

  const kept: Point[] = [];
  for (const [index, point] of points.entries()) {
    if (keep[index]) kept.push({ ...point });
  }
  return kept;
}

/**
 * Cut a run of points into runs of at most `max`, each beginning where the one before it ended.
 *
 * The join is the whole design. A stroke longer than the limit becomes two objects, and the only thing
 * that makes them read as one line is that the last point of the first is the first point of the second:
 * there is no segment missing between them, and at a normal zoom there is nothing to see.
 *
 * A final piece of one point is not cut at all — it is appended to the piece before it, which goes one
 * point over the limit. Both alternatives are defensible and this one was chosen because a piece of one
 * point is drawn as a dot in the middle of a line, which is a visible defect, whereas 5,001 numbers in a
 * `Y.Map` is not.
 *
 * The limit is `STROKE_MAX_POINTS` unless a caller says otherwise, so that the number is one number and a
 * test can ask about the boundary without restating it.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  // A limit that is not a number, or is smaller than the two points a line needs, is not a limit: a caller
  // that measured nothing gets the run back in one piece rather than in pieces nobody can draw.
  if (!Number.isFinite(max) || max < 2) return [points.map((point) => ({ ...point }))];
  if (points.length <= max) return [points.map((point) => ({ ...point }))];

  // The step is `max - 1` because the piece after a cut reuses the point the cut was made on: ten thousand
  // points at a limit of 5,000 come out as 5,000 and 5,001, not as 5,000 and 5,000 minus a join.
  //
  // This loop cannot produce a piece of one point, which is worth stating because a one-point piece would
  // be a dot drawn in the middle of a line. A piece is only begun at a step that left more than `max`
  // points behind it, which means the piece begun at the next step has more than `max - (max - 1)` points
  // — that is, more than one — and a piece is ended by reaching the end of the run, never by cutting it.
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const remaining = points.length - start;
    const size = remaining <= max ? remaining : max;
    parts.push(points.slice(start, start + size).map((point) => ({ ...point })));
    // The piece that reaches the end of the run ends the list; every other piece is followed by one that
    // begins on the point this one finished on.
    if (size === remaining) break;
    start += size - 1;
  }
  return parts;
}

/** A coordinate in the path language: rounded to a thousandth of a unit, and never in exponential notation. */
function coordinate(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  // `Number.toFixed` keeps a fixed number of digits, which doubles the size of a two-hundred-point path for
  // no reason; `String` is fine except for the numbers so small or large that it switches to `1e-7`, which
  // the path grammar does not read.
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Halfway between two points, which is where a quadratic curve is asked to pass through. */
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The SVG path data for a polyline, smoothed into a curve.
 *
 * The curve is the quadratic one every drawing app uses when it has not been given pressure: from the
 * middle of each segment, bending towards the point between, to the middle of the next. It is chosen over
 * a plain polyline because a kept point is a point that a *tremor* demanded, and a polyline draws a corner
 * at every one of them — the stroke comes out looking like the jitter that produced it. The curve passes
 * through the midpoints instead, which are on the way to the points rather than at them, and the line ends
 * up reading as the shape that was meant rather than the hand that drew it.
 *
 * The path begins at the first point and ends at the last: the ends of a stroke are where the pen touched
 * down and lifted off, and a curve that trimmed them would make every stroke slightly shorter than the
 * thing that was drawn.
 *
 * One point is `M x y L x y` — a subpath with no length. That is not a trick: a zero-length subpath stroked
 * with a round cap is a filled circle of the stroke's width, which is exactly the dot a single click with
 * the pen should leave, and it means the dot and the line are drawn by the same element with the same
 * attributes.
 */
export function smoothPath(points: readonly Point[]): string {
  const clean = points.filter((point) => point !== null && point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length === 0) return '';
  const first = clean[0] as Point;
  if (clean.length === 1) {
    const at = coordinate(first.x);
    const past = coordinate(first.y);
    return `M ${at} ${past} L ${at} ${past}`;
  }
  if (clean.length === 2) {
    const last = clean[1] as Point;
    return `M ${coordinate(first.x)} ${coordinate(first.y)} L ${coordinate(last.x)} ${coordinate(last.y)}`;
  }

  let d = `M ${coordinate(first.x)} ${coordinate(first.y)}`;
  for (let index = 1; index < clean.length - 1; index += 1) {
    const control = clean[index] as Point;
    const next = clean[index + 1] as Point;
    const through = midpoint(control, next);
    d += ` Q ${coordinate(control.x)} ${coordinate(control.y)} ${coordinate(through.x)} ${coordinate(through.y)}`;
  }
  const last = clean[clean.length - 1] as Point;
  return `${d} L ${coordinate(last.x)} ${coordinate(last.y)}`;
}
