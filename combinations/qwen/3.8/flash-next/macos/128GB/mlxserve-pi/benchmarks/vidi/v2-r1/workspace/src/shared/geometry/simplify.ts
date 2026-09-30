// The three things a stroke is made of out of a pointer path (`stroke.model`).
//
// A pen produces hundreds of samples a second and the document holds one object per
// drawing, so between the two there is a small amount of geometry with a surprisingly
// large amount of product in it: how much of the drawing is kept (TC-01, TC-02), how a
// drawing too long for one object becomes two that join (TC-03), and what the drawing is
// painted as (TC-08). All three are pure functions of points, which is why they live here
// rather than in the tool: the tool decides *when* to call them, not what they return.
import type { Point } from '../geometry';
import { distanceToSegment } from './polyline';

/**
 * Ramer-Douglas-Peucker: keep the ends of a path and, between them, anything that strays
 * further than `tolerance` from the straight line — then do the same to each half.
 *
 * The result is a polyline every one of whose removed points lies within `tolerance` of
 * it, because the recursion only ever drops a run of points once it has proved the whole
 * run is that far from the segment joining the two points it kept. That is the property
 * `pen.smooth` is stated as, and it is why the tolerance is passed in board units by the
 * caller — the tool divides its screen-pixel tolerance by the zoom, so a stroke is
 * smoothed to one screen pixel at whatever zoom it was drawn at.
 *
 * Iterative rather than recursive: a 5,000 point path is 5,000 frames of recursion in a
 * language with a stack nobody controls at runtime.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const count = points.length;
  if (count < 3 || !(tolerance > 0)) return points.map((point) => ({ ...point }));

  // Which points survive. Both ends always do: the pen went down at the first and came
  // up at the last, and neither of those is a detail to smooth away.
  const keep = new Array<boolean>(count).fill(false);
  keep[0] = true;
  keep[count - 1] = true;

  const ranges: Array<[number, number]> = [[0, count - 1]];
  while (ranges.length > 0) {
    const range = ranges.pop() as [number, number];
    const [from, to] = range;
    if (to - from < 2) continue;

    // The one point in this range that is farthest off the chord.
    let worst = -1;
    let distance = 0;
    for (let i = from + 1; i < to; i += 1) {
      const off = distanceToSegment(points[i] as Point, points[from] as Point, points[to] as Point);
      if (off > distance) {
        distance = off;
        worst = i;
      }
    }
    if (worst < 0 || distance <= tolerance) continue;

    keep[worst] = true;
    ranges.push([from, worst], [worst, to]);
  }

  return points.filter((_, index) => keep[index] === true).map((point) => ({ ...point }));
}

/**
 * Cut a path into chunks of at most `max` points, with each chunk starting at the point
 * its predecessor ended on (`pen.long_stroke`).
 *
 * Sharing the join is the whole point: two strokes whose ends are at the same place read
 * as one line drawn without lifting the pen, while each stays small enough to move, delete
 * and undo on its own. A path of exactly `max` points is one chunk, and a path no chunk
 * can be shorter than is handed back whole.
 */
export function splitPoints(points: readonly Point[], max = 5_000): Point[][] {
  if (points.length === 0) return [];
  if (max < 2 || points.length <= max) return [points.map((point) => ({ ...point }))];

  const chunks: Point[][] = [];
  let start = 0;
  while (points.length - start > max) {
    chunks.push(points.slice(start, start + max).map((point) => ({ ...point })));
    // The next chunk opens where this one closed.
    start += max - 1;
  }
  chunks.push(points.slice(start).map((point) => ({ ...point })));
  return chunks;
}

/** How a coordinate is written into a path: enough digits to be the same number again. */
const at = (value: number): string => String(Math.round(value * 1000) / 1000);

/**
 * The points as one SVG path of quadratic Béziers, each curve pulled towards a sample and
 * ending at the middle of the gap on either side of it (`stroke.model`).
 *
 * This is what makes a stroke look drawn rather than plotted: the line never turns at a
 * sample, it only leans towards one, so a jittery path comes out as a curve. It is also
 * why the drawing is stable — the path is a function of the points and nothing else, so
 * every screen holding the same stroke paints the same pixels (TC-08).
 *
 * A quadratic's control point is inside the hull of the samples it came from, so the curve
 * bulges no further from the recorded path than the points themselves are — the line stays
 * inside the stroke's box at any size.
 *
 * One point draws a line of no length, which `stroke-linecap: round` turns into a dot: a
 * pen that went down and came up in the same place left a dot, and that is what appears.
 */
export function smoothPath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  let path = `M${at(first.x)} ${at(first.y)}`;

  for (let i = 1; i <= points.length - 2; i += 1) {
    const point = points[i] as Point;
    const next = points[i + 1] as Point;
    path += ` Q${at(point.x)} ${at(point.y)} ${at((point.x + next.x) / 2)} ${at((point.y + next.y) / 2)}`;
  }

  const last = points[points.length - 1] as Point;
  if (points.length > 1) path += ` Q${at(last.x)} ${at(last.y)} ${at(last.x)} ${at(last.y)}`;
  return path;
}
