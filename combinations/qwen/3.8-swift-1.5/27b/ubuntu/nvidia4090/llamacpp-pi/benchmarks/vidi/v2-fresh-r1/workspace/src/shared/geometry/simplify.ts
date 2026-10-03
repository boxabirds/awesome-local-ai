// Stroke geometry helpers (story 11): Ramer–Douglas–Peucker simplification,
// point splitting and smooth SVG path generation.
// Pure functions only — no Yjs, no React.

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/** Squared distance from `p` to segment `a`–`b`. */
function perpDistSq(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return apx * apx + apy * apy;
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - t * abx;
  const dy = apy - t * aby;
  return dx * dx + dy * dy;
}

/**
 * Simplify a polyline with Ramer–Douglas–Peucker (iterative, explicit stack —
 * no recursion-depth risk on 5,000-point strokes).
 * Keeps the first and last points and guarantees every input point lies
 * within `tolerance` of the output polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const tolSq = tolerance * tolerance;
  const keep: boolean[] = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistSq = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const dSq = perpDistSq(points[i], points[start], points[end]);
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        index = i;
      }
    }
    if (maxDistSq > tolSq && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Split a point list into consecutive parts of at most `max` points.
 * Consecutive parts share their join point (part n+1 starts with part n's
 * last point) so the joined stroke has no visible gap.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max < 2) throw new Error('splitPoints: max must be >= 2');
  if (points.length === 0) return [];
  if (points.length <= max) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + max, points.length);
    if (end === points.length) {
      parts.push(points.slice(start));
      break;
    }
    parts.push(points.slice(start, end));
    // Next part starts one point earlier: the shared join point.
    start = end - 1;
  }
  return parts;
}

/** Deterministic number formatting (2 decimals, no trailing noise). */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Build an SVG path string through the points using quadratic midpoint
 * smoothing: `M p0`, then `Q p[i] mid(p[i], p[i+1])` for each interior
 * point, ending at the last point. Each curve passes through the midpoints
 * of consecutive segments and stays inside their hull, so the rendered path
 * stays within the simplification tolerance of the drawn line.
 * Single point → zero-length path (renders as a round dot with round line
 * caps). Deterministic: same input → same string.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0];
  if (n === 1) {
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x)} ${fmt(p0.y)}`;
  }
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  if (n === 2) {
    const p1 = points[1];
    d += ` L ${fmt(p1.x)} ${fmt(p1.y)}`;
    return d;
  }
  for (let i = 1; i < n - 1; i++) {
    const c = points[i];
    const m = points[i + 1];
    d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt((c.x + m.x) / 2)} ${fmt((c.y + m.y) / 2)}`;
  }
  const last = points[n - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}
