import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';
import { pointToSegment } from './polyline';

/**
 * Stroke geometry (story 11, stroke.model). Pure functions shared by the Pen
 * tool (commit path) and the stroke object (rendering / hit testing).
 */

/**
 * Ramer–Douglas–Peucker polyline simplification (iterative, explicit stack —
 * no recursion-depth risk on STROKE_MAX_POINTS points).
 *
 * Keeps the first and last point; every removed point was within `tolerance`
 * of a segment whose endpoints survive, so the simplified polyline stays
 * faithful to the drawn path (pen.smooth). Degenerate inputs (0 or 1 points)
 * are returned unchanged (a copy).
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const n = points.length;
  const keep: boolean[] = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let maxDist = -1;
    let index = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = pointToSegment(points[i], points[a], points[b]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = true;
      stack.push([a, index], [index, b]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

/**
 * Splits a raw point list into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS) that join seamlessly: each part (except the
 * first) starts with the previous part's last point (pen.long_stroke).
 * A list of `max` points or fewer is a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max < 2) throw new Error('splitPoints: max must be >= 2');
  if (points.length <= max) {
    return points.length > 0 ? [points.slice()] : [];
  }
  const parts: Point[][] = [];
  for (let start = 0; start < points.length; start += max - 1) {
    const end = Math.min(start + max, points.length);
    parts.push(points.slice(start, end));
  }
  return parts;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * SVG path through `points` using quadratic segments to the midpoints:
 * `M p0`, then `Q p[i] mid(p[i], p[i+1])` for i = 1..n-2, ending exactly at
 * the last point (the final segment is a Q whose control point is the last
 * point itself — a straight run into it). The path is deterministic for a
 * deterministic input.
 *
 * - Zero points: the empty string.
 * - One point: a zero-length subpath (`M p L p`) — with round line caps it
 *   renders as a round dot (pen.dot).
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const fmt = (p: Point): string => `${round3(p.x)} ${round3(p.y)}`;
  if (points.length === 1) {
    const p = points[0];
    return `M ${fmt(p)} L ${fmt(p)}`;
  }
  let d = `M ${fmt(points[0])}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const next = points[i + 1];
    d += ` Q ${fmt(p)} ${round3((p.x + next.x) / 2)} ${round3((p.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1];
  d += ` Q ${fmt(last)} ${fmt(last)}`;
  return d;
}
