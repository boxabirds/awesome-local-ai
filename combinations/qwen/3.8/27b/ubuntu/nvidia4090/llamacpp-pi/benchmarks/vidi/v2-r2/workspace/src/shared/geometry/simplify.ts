/**
 * Stroke point processing (story 11, design stroke.model):
 *
 * - `simplify`: iterative Ramer–Douglas–Peucker with an explicit stack (no
 *   recursion depth risk on 5,000-point strokes). Keeps the first and last
 *   point and guarantees that every removed point lies within `tolerance`
 *   of a segment of the result, i.e. the simplified polyline never deviates
 *   more than `tolerance` from what the user drew (smoothing faithfulness).
 * - `splitPoints`: chunks a point sequence into parts of at most `max`
 *   points, consecutive parts sharing their join point (the second part
 *   starts with the first part's last point) so a very long stroke commits
 *   as several strokes that join with no gap (pen.long_stroke).
 * - `smoothPath`: a deterministic SVG path through the points — `M p0` then
 *   midpoint quadratic segments that pass through the midpoints of
 *   consecutive points and end at the last point (the rendered curve stays
 *   inside the segment hull, so it too stays within the simplify
 *   tolerance). A single point yields a zero-length path that a round
 *   stroke cap renders as a dot (pen.dot).
 *
 * Pure and dependency-free: no DOM, no React, no document access.
 */
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/**
 * Ramer–Douglas-Peucker simplification. Points whose maximum perpendicular
 * deviation from the kept segment chain is ≤ `tolerance` are removed. The
 * first and last point are always kept. An empty input returns empty; a
 * one- or two-point input is returned as a copy.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n === 0) {
    return [];
  }
  if (n <= 2 || !(tolerance >= 0) || !Number.isFinite(tolerance)) {
    return points.slice();
  }
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    const a = points[start];
    const b = points[end];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLen2 = abx * abx + aby * aby;
    let maxDist2 = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      let dist2: number;
      if (abLen2 === 0) {
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        dist2 = dx * dx + dy * dy;
      } else {
        // Squared distance = (cross product)^2 / |ab|^2.
        const cross = (p.x - a.x) * aby - (p.y - a.y) * abx;
        dist2 = (cross * cross) / abLen2;
      }
      if (dist2 > maxDist2) {
        maxDist2 = dist2;
        index = i;
      }
    }
    if (index !== -1 && maxDist2 > tol2) {
      keep[index] = 1;
      stack.push(start, index, index, end);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i] !== 0) {
      out.push(points[i]);
    }
  }
  return out;
}

/**
 * Splits `points` into parts of at most `max` points each. Consecutive parts
 * share their join point: part k+1 starts with part k's last point. A
 * sequence of at most `max` points yields a single part (a copy); an empty
 * sequence yields no parts.
 */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  const n = points.length;
  if (n === 0 || max <= 0) {
    return [];
  }
  if (n <= max) {
    return [points.slice()];
  }
  const stride = max - 1; // parts overlap in the shared join point
  const parts: Point[][] = [];
  for (let start = 0; start < n; start += stride) {
    const end = Math.min(n - 1, start + max - 1);
    parts.push(points.slice(start, end + 1));
  }
  return parts;
}

/** Deterministic number formatting for path output (at most 2 decimals). */
function fmt(v: number): string {
  return String(Number(v.toFixed(2)));
}

function pointToString(p: Point): string {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}

/**
 * Deterministic SVG path through the points (design smoothPath):
 *
 * - 0 points: the empty string.
 * - 1 point: a zero-length path (`M x y l 0 0`) that a round stroke cap
 *   renders as a dot.
 * - 2 points: `M p0 L p1`.
 * - 3+ points: `M p0 L m(p0,p1)` then `Q p[i] m(p[i], p[i+1])` for
 *   i = 1..n−2, ending with `L p[n−1]`. Every curve passes through the
 *   midpoints of consecutive segments and stays inside their hull.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) {
    return '';
  }
  if (n === 1) {
    const p = points[0];
    return `M ${fmt(p.x)} ${fmt(p.y)} l 0 0`;
  }
  if (n === 2) {
    return `M ${pointToString(points[0])} L ${pointToString(points[1])}`;
  }
  const mid = (a: Point, b: Point): string =>
    `${fmt((a.x + b.x) / 2)} ${fmt((a.y + b.y) / 2)}`;
  let d = `M ${pointToString(points[0])} L ${mid(points[0], points[1])}`;
  for (let i = 1; i < n - 1; i++) {
    d += ` Q ${pointToString(points[i])} ${mid(points[i], points[i + 1])}`;
  }
  d += ` L ${pointToString(points[n - 1])}`;
  return d;
}
