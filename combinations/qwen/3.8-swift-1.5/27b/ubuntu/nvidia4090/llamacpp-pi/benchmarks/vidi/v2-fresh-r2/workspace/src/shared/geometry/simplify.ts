/**
 * Stroke path geometry (story 11, stroke.model).
 *
 * - `simplify`: Ramer–Douglas–Peucker (iterative, explicit stack)
 * - `splitPoints`: chunk points at STROKE_MAX_POINTS with a shared join point
 * - `smoothPath`: SVG path string using quadratic midpoints
 *
 * All values are world (board) units.
 */

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Perpendicular distance from point `p` to the line through `a` and `b`.
 */
function perpendicularDistance(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Ramer–Douglas–Peucker simplification (iterative with an explicit stack
 * to avoid recursion depth issues on 5,000+ point strokes).
 *
 * Keeps the first and last points. Guarantees every removed point is within
 * `tolerance` of the resulting polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Explicit stack of [start, end] index pairs
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;

    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[start], points[end], points[i]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Split a long point sequence into chunks of at most `max` points,
 * where consecutive parts share the join point (the last point of part N
 * is the first point of part N+1).
 */
export function splitPoints(points: readonly Point[], max?: number): Point[][] {
  const limit = max ?? STROKE_MAX_POINTS;
  if (points.length <= limit) return [[...points]];

  const parts: Point[][] = [];
  let i = 0;
  while (i < points.length) {
    const end = Math.min(i + limit, points.length);
    parts.push([...points.slice(i, end)]);
    if (end >= points.length) break;
    // Next part starts at the last point of this part (shared join point)
    i = end - 1;
  }
  return parts;
}

/**
 * Build an SVG path string using quadratic Bézier midpoint smoothing.
 *
 * For a sequence of points p0, p1, ..., pn:
 * - Start with M p0
 * - For each pair, draw a Q segment from the current midpoint to the next
 *   midpoint, using the point as the control.
 *
 * A single point produces a zero-length path (a round dot with round caps).
 * Two points produces a straight line.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // Zero-length path for a round dot
    const { x, y } = points[0];
    return `M ${x} ${y} L ${x} ${y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const parts: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    parts.push(`Q ${points[i].x} ${points[i].y} ${midX} ${midY}`);
  }
  // End at the last point
  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);

  return parts.join(' ');
}
