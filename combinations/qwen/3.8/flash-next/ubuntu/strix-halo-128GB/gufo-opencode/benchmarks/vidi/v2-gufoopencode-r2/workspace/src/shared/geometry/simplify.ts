// Story 11: freehand stroke geometry — Ramer-Douglas-Peucker simplification,
// point-limit splitting and quadratic-midpoint smoothing. Pure functions.

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

// Ramer-Douglas-Peucker. Guarantees every raw point lies within `tolerance`
// of the result polyline; always keeps the first and last points.
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    const a = points[first];
    const b = points[last];
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > first) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push({ ...points[i] });
  }
  return out;
}

// Splits a point list into parts of at most `max` points. Consecutive parts
// share their join point, so committed stroke parts connect with no gap.
export function splitPoints(points: readonly Point[], max = STROKE_MAX_POINTS): Point[][] {
  if (max < 2) throw new Error('splitPoints: max must be at least 2');
  if (points.length <= max) return [points.map((p) => ({ ...p }))];
  const parts: Point[][] = [];
  let start = 0;
  while (points.length - start > max) {
    parts.push(points.slice(start, start + max).map((p) => ({ ...p })));
    start += max - 1;
  }
  parts.push(points.slice(start).map((p) => ({ ...p })));
  return parts;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// SVG path through quadratic curves whose control points are the given
// points and whose on-curve points are segment midpoints; ends exactly at
// the first and last point. One point renders a zero-length round-capped
// subpath (a dot). Deterministic: same input, same string.
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0];
  if (points.length === 1) {
    return `M ${round2(p0.x)} ${round2(p0.y)} L ${round2(p0.x)} ${round2(p0.y)}`;
  }
  let d = `M ${round2(p0.x)} ${round2(p0.y)}`;
  if (points.length === 2) {
    const p1 = points[1];
    return `${d} L ${round2(p1.x)} ${round2(p1.y)}`;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i];
    const next = points[i + 1];
    d += ` Q ${round2(c.x)} ${round2(c.y)} ${round2((c.x + next.x) / 2)} ${round2((c.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${round2(last.x)} ${round2(last.y)}`;
}
