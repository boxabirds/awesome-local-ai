// Stroke point simplification and path output (see spec: stroke.model).
//
// Pure maths, no DOM, no React, no Yjs. `simplify` runs Ramer–Douglas–
// Peucker iteratively (explicit stack: no recursion depth risk on
// 5,000-point strokes) and guarantees every input point stays within
// `tolerance` of the output polyline (pen.smooth). `splitPoints` chunks a
// very long stroke into consecutive parts sharing the join point
// (pen.long_stroke). `smoothPath` renders midpoint quadratic curves.

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker simplification. Keeps the first and last point and
 * every point farther than `tolerance` from the line joining its kept
 * neighbours, so no input point lies farther than `tolerance` from the
 * output polyline. Empty input → empty output; a single point → itself.
 * Iterative (explicit stack) so 5,000-point strokes are safe.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2 || !Number.isFinite(tolerance) || tolerance < 0) return points.slice();

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    const a = points[lo]!;
    const b = points[hi]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;

    let maxDist = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i += 1) {
      const p = points[i]!;
      let dist: number;
      if (len2 === 0) {
        dist = Math.hypot(p.x - a.x, p.y - a.y);
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
        dist = Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
      }
      if (dist > maxDist) {
        maxDist = dist;
        idx = i;
      }
    }

    if (maxDist > tolerance && idx > lo) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i]) out.push(points[i]!);
  }
  return out;
}

/**
 * Split a point sequence into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS). Consecutive parts share the join point: part
 * k+1 starts with part k's last point, so the parts join seamlessly.
 * Empty input → []; at most max points → a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max <= 0) throw new Error('splitPoints: max must be positive');
  const out: Point[][] = [];
  if (points.length === 0) return out;
  let part: Point[] = [];
  for (const p of points) {
    part.push(p);
    if (part.length >= max) {
      out.push(part);
      part = [part[part.length - 1]!]; // the join point starts the next part
    }
  }
  if (part.length > 1) out.push(part); // a lone join point is not a new part
  return out;
}

/** Round to 3 decimals for a compact, deterministic path string. */
function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * An SVG path through the points using quadratic midpoint segments:
 * `M p0`, then `Q p[i] mid(p[i], p[i+1])` for each interior point, ending at
 * the last point. A single point renders as a zero-length path (a round
 * cap draws the dot). Deterministic for deterministic input.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0]!;
  if (n === 1) return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x)} ${fmt(p0.y)}`;
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i < n; i += 1) {
    const c = points[i]!;
    const next = points[i + 1];
    const ex = next !== undefined ? (c.x + next.x) / 2 : c.x;
    const ey = next !== undefined ? (c.y + next.y) / 2 : c.y;
    d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt(ex)} ${fmt(ey)}`;
  }
  return d;
}
