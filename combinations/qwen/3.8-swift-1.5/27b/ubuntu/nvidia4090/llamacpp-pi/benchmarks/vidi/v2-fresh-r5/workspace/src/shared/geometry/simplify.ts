/**
 * Stroke simplification and path helpers (story 11). Pure functions; no DOM,
 * no React imports.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker simplification. Keeps the first and last point and
 * guarantees every removed point lies within `tolerance` (world units) of the
 * resulting polyline (pen.smooth: smoothing stays faithful).
 *
 * Iterative (explicit stack) so 5,000-point strokes carry no recursion depth
 * risk.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return [...points];

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > tolerance) {
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

/** Perpendicular distance from `p` to the segment `a`→`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Split a point sequence into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS). Consecutive parts share the join point, so
 * committing each part as a separate stroke joins with no visible gap
 * (pen.long_stroke).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  const parts: Point[][] = [];
  let i = 0;
  while (i < points.length) {
    const end = Math.min(i + max, points.length);
    parts.push(points.slice(i, end));
    if (end >= points.length) break;
    i = end - 1; // share the join point with the next part
  }
  return parts;
}

/** Format a coordinate deterministically (up to 2 decimal places). */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Build an SVG path string through the given points using quadratic midpoint
 * curves. Each Q segment uses points[i] as control point and ends at the
 * midpoint of segment (i, i+1); the curve passes through the midpoints and
 * stays inside their hull, so it remains within the simplify tolerance of the
 * drawn path. A single point yields a zero-length path that renders as a
 * round dot with round line caps.
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
    const p = points[i];
    const q = points[i + 1];
    d += ` Q ${fmt(p.x)} ${fmt(p.y)} ${fmt((p.x + q.x) / 2)} ${fmt((p.y + q.y) / 2)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}
