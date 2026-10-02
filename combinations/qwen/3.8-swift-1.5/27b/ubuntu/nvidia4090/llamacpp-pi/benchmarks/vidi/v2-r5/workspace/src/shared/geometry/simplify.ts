// src/shared/geometry/simplify.ts
// Ramer-Douglas-Peucker simplification, point splitting, and SVG path smoothing.

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker line simplification.
 * Uses an explicit stack to avoid recursion depth issues with 5000+ points.
 * Guarantees every original point is within `tolerance` of the output polyline.
 * Keeps first and last points.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Explicit stack of [start, end] index pairs
  const stack: number[] = [0, n - 1];

  while (stack.length > 0) {
    const end = stack.pop()!;
    const start = stack.pop()!;

    let maxDist = -1;
    let maxIdx = -1;

    const ax = points[start].x;
    const ay = points[start].y;
    const bx = points[end].x;
    const by = points[end].y;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    for (let i = start + 1; i < end; i++) {
      let dist: number;
      if (lenSq === 0) {
        dist = Math.hypot(points[i].x - ax, points[i].y - ay);
      } else {
        // Distance from point to line segment
        let t = ((points[i].x - ax) * dx + (points[i].y - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx;
        const py = ay + t * dy;
        dist = Math.hypot(points[i].x - px, points[i].y - py);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push(start, maxIdx, maxIdx, end);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Splits a point array into chunks of at most `max` points.
 * Consecutive parts share the join point (last of part N = first of part N+1).
 */
export function splitPoints(points: readonly Point[], max?: number): Point[][] {
  const limit = max ?? STROKE_MAX_POINTS;
  if (points.length <= limit) return [points as Point[]];

  const parts: Point[][] = [];
  for (let i = 0; i < points.length; i += limit - 1) {
    const end = Math.min(i + limit, points.length);
    const part = points.slice(i, end);
    parts.push(part);
    if (end < points.length) {
      // The next part will start at `end` which is the same as the last point of this part
      // because we step by (limit - 1), so the next start = i + (limit-1) = end - 1 + 1 = end
      // Wait: i starts at 0, step is limit-1.
      // Part 1: [0, limit) → indices 0..limit-1
      // Part 2: [limit-1, 2*limit-1) → indices limit-1..2*limit-2
      // So part 2 starts at index limit-1 which IS the last point of part 1. ✓
    }
  }

  return parts;
}

/**
 * Generates an SVG path string using quadratic Bézier midpoint smoothing.
 * - Single point: zero-length path (renders as a dot with round caps).
 * - Multiple points: M p0, then Q segments through midpoints.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const { x, y } = points[0];
    return `M ${x} ${y} L ${x} ${y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  if (points.length === 2) {
    d += ` L ${points[1].x} ${points[1].y}`;
    return d;
  }

  // Quadratic midpoint smoothing:
  // For each consecutive pair, the curve goes through the midpoint.
  // Q control = current point, end = midpoint(current, next)
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  // Final segment to the last point
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}
