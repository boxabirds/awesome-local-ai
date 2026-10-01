/**
 * Stroke geometry: simplification (Ramer-Douglas-Peucker), splitting, and SVG path smoothing.
 *
 * All coordinates are in world units.
 */

import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker polyline simplification (iterative, no recursion depth risk).
 * Keeps first and last points. Guarantees every input point is within `tolerance`
 * of the output polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Use an explicit stack for the iterative version
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx <= startIdx + 1) continue;

    const start = points[startIdx]!;
    const end = points[endIdx]!;

    let maxDist = 0;
    let maxIdx = startIdx;

    for (let i = startIdx + 1; i < endIdx; i++) {
      const d = perpendicularDistance(points[i]!, start, end);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx]);
      stack.push([maxIdx, endIdx]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]!);
  }
  return result;
}

/** Perpendicular distance from point `p` to line segment `ab`. */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
  return num / Math.sqrt(lenSq);
}

/**
 * Split a point array into chunks of at most `max` points.
 * Each subsequent part starts with the last point of the previous part (shared join point).
 * Returns a single-element array when length <= max.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [[...points]];

  const parts: Point[][] = [];
  let offset = 0;
  while (offset < points.length) {
    if (offset === 0) {
      // First part: take exactly `max` points
      parts.push([...points.slice(offset, offset + max)]);
      offset += max - 1; // overlap by 1 (the last point is the join point)
    } else {
      // Subsequent parts: start from the last point of the previous part
      parts.push([...points.slice(offset, offset + max)]);
      offset += max - 1;
    }
  }

  // If the last part is only 1 point (just the join point), merge it back
  if (parts.length > 1 && parts[parts.length - 1]!.length === 1) {
    const lastPart = parts.pop()!;
    const prevPart = parts[parts.length - 1]!;
    prevPart.push(lastPart[0]!);
  }

  return parts;
}

/**
 * Generate an SVG path string using quadratic Bézier curves through midpoints.
 * This produces a smooth path that passes through midpoints of consecutive
 * simplified points, staying within the hull of the segments.
 *
 * Single point → zero-length path (M x y) for round-cap dot rendering.
 * Two points → simple line M ... L ...
 * Three+ points → M, then Q segments through midpoints, ending at last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0]!.x} ${points[0]!.y}`;
  }
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  // Three or more points: quadratic curves through midpoints
  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  // First segment: line to midpoint of first two points
  // Actually, start with a Q from p0 through p1 to mid(p1,p2)
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i]!;
    const next = points[i + 1]!;
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
  }

  // Last segment: Q through the last point
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;

  return d;
}
