/**
 * Point reduction for freehand strokes (story 11).
 *
 * A pen drag records every pointer sample the browser offers, which is far more points than a line
 * needs: a 400-sample circle drawn by hand is a handful of straight runs and a few genuine turns.
 * `simplify` is Ramer-Douglas-Peucker, which has the property the PRD asks for (`pen.smooth`): every
 * point that was drawn lies within `tolerance` of the returned path, so smoothing a stroke cannot
 * move it away from what the hand did - it only removes the samples that were never carrying
 * information.
 *
 * `splitPoints` cuts a drag that ran past `STROKE_MAX_POINTS` into consecutive parts that share their
 * join point, and `smoothPath` turns points into an SVG `d` of quadratic midpoint curves: the curve
 * passes through the middle of every segment and is pulled towards the sample at its end, which is
 * what makes a stroke of a few dozen points look drawn rather than faceted.
 *
 * All coordinates are in whatever space the points were recorded in - world units for stored strokes,
 * screen pixels for the preview - and the tolerance is in the same units.
 */
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/** Squared distance from `p` to the segment `a`-`b`; squared, because nothing here takes a root. */
function squaredSegmentDistance(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const length = vx * vx + vy * vy;
  if (length === 0) return (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / length));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return dx * dx + dy * dy;
}

/**
 * Ramer-Douglas-Peucker: the subsequence of `points` whose polyline stays within `tolerance` of the
 * path through all of them. The first and last points are always kept - they are where the pen went
 * down and where it came up.
 *
 * The loop is iterative on purpose: a 5,000-sample drag would otherwise recurse a couple of thousand
 * frames deep, and a stroke is only interesting when it is long.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const squared = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const span = stack.pop();
    if (!span) continue;
    const [from, to] = span;
    if (to - from < 2) continue;
    const a = points[from]!;
    const b = points[to]!;
    let worst = squared;
    let worstIndex = -1;
    for (let i = from + 1; i < to; i += 1) {
      const distance = squaredSegmentDistance(points[i]!, a, b);
      if (distance > worst) {
        worst = distance;
        worstIndex = i;
      }
    }
    if (worstIndex >= 0) {
      keep[worstIndex] = 1;
      stack.push([from, worstIndex], [worstIndex, to]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i] === 1) {
      const p = points[i]!;
      result.push({ x: p.x, y: p.y });
    }
  }
  return result;
}

/**
 * Cuts a point list into chunks of at most `max` points, each part starting with the last point of the
 * one before it. The shared join point is what makes two halves of one endless drag read as one line
 * with no gap where the limit was crossed.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  const size = Math.max(2, Math.floor(max));
  if (points.length <= size) return [points.map((p) => ({ x: p.x, y: p.y }))];

  const parts: Point[][] = [];
  let start = 0;
  while (points.length - start > size) {
    parts.push(points.slice(start, start + size).map((p) => ({ x: p.x, y: p.y })));
    // the next part takes the last point of this one with it, so it is `size - 1` new samples on
    start += size - 1;
  }
  parts.push(points.slice(start).map((p) => ({ x: p.x, y: p.y })));
  return parts;
}

/** A coordinate as short as it will go without losing the number: the writer and reader agree. */
function at(value: number): string {
  return String(value);
}

/**
 * An SVG path through `points`: `M` to the first, one quadratic curve per interior point bulging
 * towards it and landing on the midpoint of the next segment, and a line to the very last point so the
 * drawing finishes where the drawing ends rather than half a segment short of it.
 *
 * One point becomes a zero-length path, which a round line cap turns into a dot.
 */
export function smoothPath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) {
    return `M ${at(first.x)} ${at(first.y)} L ${at(first.x)} ${at(first.y)}`;
  }

  let d = `M ${at(first.x)} ${at(first.y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i]!;
    const next = points[i + 1]!;
    d += ` Q ${at(p.x)} ${at(p.y)} ${at((p.x + next.x) / 2)} ${at((p.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${at(last.x)} ${at(last.y)}`;
}
