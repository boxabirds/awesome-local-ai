import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Stroke geometry (story 11): Ramer–Douglas–Peucker simplification,
 * long-stroke splitting and the smoothed SVG path. Pure functions — no Yjs,
 * no DOM.
 */

/** Perpendicular distance from `p` to the line segment `a`–`b` (clamped). */
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance from `p` to the polyline `pts` (for the faithfulness fix-up). */
function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = perpDistance(p, pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Ramer–Douglas–Peucker simplification (iterative, explicit stack — no
 * recursion depth risk on 5,000-point strokes). Keeps the first and last
 * points and guarantees that every input point lies within `tolerance` of
 * the output polyline (pen.smooth: smoothing stays faithful).
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;

  // Iterative RDP.
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIdx = -1;
    const a = points[start];
    const b = points[end];
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tol && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }

  // Faithfulness fix-up: re-insert any point that ended up farther than the
  // tolerance from the output polyline (the chord that removed it may not be
  // an edge of the final polyline). Inserting only ever shrinks distances,
  // so the loop terminates with the guaranteed bound.
  for (;;) {
    let violating = -1;
    for (let i = 0; i < n; i++) {
      if (!keep[i] && distanceToPolyline(result, points[i]) > tol) {
        violating = i;
        break;
      }
    }
    if (violating < 0) break;
    result.splice(outputIndexForInput(keep, violating), 0, points[violating]);
    keep[violating] = 1;
  }
  return result;
}

/** Position in the output just after the last kept input point with index < `i`. */
function outputIndexForInput(keep: Uint8Array, i: number): number {
  let pos = 0;
  for (let j = 0; j < i; j++) {
    if (keep[j]) pos++;
  }
  return pos;
}

/**
 * Splits a long stroke into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS). Consecutive parts share the join point, so
 * the parts draw on with no visible gap (pen.long_stroke).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max < 2) throw new Error('splitPoints: max must be at least 2');
  if (points.length === 0) return [];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const part = points.slice(start, start + max);
    parts.push(part);
    const end = start + part.length;
    if (end >= points.length) break;
    start = end - 1; // the next part shares the join point
  }
  return parts;
}

/**
 * The smoothed SVG path through `points`: `M p0`, then quadratic segments
 * `Q p[i] mid(p[i], p[i+1])` ending at the last point. Midpoint quadratics
 * pass through the midpoints of consecutive segments and stay inside their
 * hull, so the rendered stroke stays within the simplify tolerance of the
 * drawn path. A single point yields a zero-length path rendered as a round
 * dot by the round line caps. Deterministic for a given input.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0];
  if (n === 1) return `M ${p0.x} ${p0.y} L ${p0.x} ${p0.y}`;
  let d = `M ${p0.x} ${p0.y}`;
  if (n === 2) {
    d += ` L ${points[1].x} ${points[1].y}`;
    return d;
  }
  for (let i = 1; i < n - 1; i++) {
    const c = points[i];
    const e = points[i + 1];
    d += ` Q ${c.x} ${c.y} ${(c.x + e.x) / 2} ${(c.y + e.y) / 2}`;
  }
  const last = points[n - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
