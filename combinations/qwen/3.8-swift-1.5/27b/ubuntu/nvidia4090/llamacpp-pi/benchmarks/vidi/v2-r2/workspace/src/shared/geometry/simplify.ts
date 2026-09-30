/**
 * Stroke simplification and path rendering (story 11, stroke.model).
 *
 * - `simplify`: iterative Ramer–Douglas–Peucker. Guarantees every input point
 *   lies within `tolerance` of the output polyline (smoothing faithfulness:
 *   with tolerance STROKE_SIMPLIFY_TOLERANCE_PX / zoom that is 1 screen pixel
 *   at the drawing zoom).
 * - `splitPoints`: chunks a long point list into parts of at most
 *   STROKE_MAX_POINTS that join seamlessly (part N+1 starts with part N's
 *   last point).
 * - `smoothPath`: SVG path through the points using quadratic curves to
 *   segment midpoints; a single point yields a zero-length path that renders
 *   as a round dot with round line caps.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/** Perpendicular distance from point p to the infinite line through a-b. */
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/**
 * Ramer–Douglas–Peucker simplification (iterative, explicit stack — no
 * recursion depth risk on 5,000-point strokes). Keeps the first and last
 * point. Every input point is within `tolerance` of the result.
 * Fewer than 3 points are returned unchanged.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];
  if (!Number.isFinite(tolerance) || tolerance <= 0) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Stack of [start, end] index pairs to process.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance && maxIdx > 0) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Splits `points` into consecutive parts of at most `max` points (default
 * STROKE_MAX_POINTS). Consecutive parts share the join point: part N+1 starts
 * with part N's last point, so committed strokes join with no visible gap.
 * A list of at most `max` points yields a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  if (!Number.isFinite(max) || max < 2) return [[...points]];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + max, points.length);
    if (end === points.length) {
      parts.push([...points.slice(start)]);
      break;
    }
    parts.push([...points.slice(start, end)]);
    start = end - 1; // shared join point
  }
  return parts;
}

/** Deterministic 2-decimal number formatting for path data. */
function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * SVG path data through the given points using quadratic Bézier segments to
 * segment midpoints:
 *   - 0 points → '' (no path)
 *   - 1 point  → zero-length path (renders as a round dot with round caps)
 *   - 2 points → straight segment
 *   - n ≥ 3    → M p0, Q p[i] mid(p[i], p[i+1]) for interior points, ending
 *                exactly at the last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${fmt(p.x)} ${fmt(p.y)} L ${fmt(p.x)} ${fmt(p.y)}`;
  }
  if (points.length === 2) {
    const [a, b] = points;
    return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i];
    const n = points[i + 1];
    const mx = (c.x + n.x) / 2;
    const my = (c.y + n.y) / 2;
    d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt(mx)} ${fmt(my)}`;
  }
  const last = points[points.length - 1];
  d += ` Q ${fmt(last.x)} ${fmt(last.y)} ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}
