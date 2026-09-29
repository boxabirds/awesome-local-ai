/**
 * Stroke geometry helpers (story 11).
 * simplify: Ramer-Douglas-Peucker polyline simplification.
 * splitPoints: chunk points at STROKE_MAX_POINTS with shared join point.
 * smoothPath: SVG path string using quadratic midpoint curves.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Perpendicular distance from point p to the line segment a–b.
 */
function perpDist(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Area of triangle * 2 / base length
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx);
  return cross / Math.sqrt(lenSq);
}

/**
 * Ramer-Douglas-Peucker simplification. Iterative (explicit stack) to handle
 * up to 5000 points without recursion depth issues. Guarantees every input
 * point is within `tolerance` of the output polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.slice();

  // Boolean array marking which points to keep
  const keep: boolean[] = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  // Explicit stack of (start, end) index pairs
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    // Find the point with maximum distance from the line start→end
    let maxDist = -1;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(points[start], points[end], points[i]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  // Build result
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Split points into chunks of at most `max` points. Consecutive parts share
 * their join point (last of part i = first of part i+1).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.slice()];

  const parts: Point[][] = [];
  let i = 0;
  while (i < points.length) {
    const remaining = points.length - i;
    if (remaining <= max) {
      parts.push(points.slice(i));
      break;
    }
    parts.push(points.slice(i, i + max));
    // Next part starts at the last point of the current part (shared join)
    i = i + max - 1;
  }
  return parts;
}

/**
 * Generate an SVG path string using quadratic midpoint smoothing.
 * Starts with M, uses Q segments. Single point → zero-length path for a round dot.
 *
 * Algorithm: M p0, then for each pair (pi, pi+1), Q pi mid(pi, pi+1).
 * Last segment goes directly to the final point.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  // Start at first point
  let d = `M ${points[0].x} ${points[0].y}`;

  // Use quadratic curves through midpoints
  for (let i = 1; i < n - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  // Last segment: quadratic to the last point
  const last = points[n - 1];
  const prev = points[n - 2];
  d += ` Q ${prev.x} ${prev.y} ${last.x} ${last.y}`;

  return d;
}
