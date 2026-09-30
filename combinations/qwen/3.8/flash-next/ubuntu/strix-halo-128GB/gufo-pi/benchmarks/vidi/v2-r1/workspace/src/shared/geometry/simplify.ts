/**
 * Stroke geometry: Ramer-Douglas-Peucker simplification, splitting, and SVG path generation.
 * Story 11.
 */

import type { Point } from '../board-model';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker polyline simplification (iterative, stack-based).
 * Keeps first and last point. Every removed point lies within `tolerance` of
 * the result polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return [...points];

  // Iterative RDP using an explicit stack to avoid recursion depth issues with 5000+ points
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Stack of [startIdx, endIdx] pairs
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    let maxDist = 0;
    let maxIdx = start;

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
        let t = ((points[i].x - ax) * dx + (points[i].y - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = ax + t * dx;
        const projY = ay + t * dy;
        dist = Math.hypot(points[i].x - projX, points[i].y - projY);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Split points into chunks of at most `max` points.
 * Parts share the join point: part[i+1] starts with part[i]'s last point.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.length > 0 ? [...points] : []];

  const parts: Point[][] = [];
  let offset = 0;
  while (offset < points.length) {
    if (offset === 0) {
      // First chunk: exactly `max` points
      const chunk = points.slice(offset, offset + max);
      parts.push([...chunk]);
      // Next chunk starts at the last point of this chunk
      offset = offset + max - 1;
    } else {
      // Subsequent chunks: we already have the join point, so take `max` including it
      const chunk = points.slice(offset, offset + max);
      parts.push([...chunk]);
      offset = offset + max - 1;
    }
    // Safety: if the remaining is just 1 point (the join point itself), we're done
    if (offset >= points.length - 1) break;
  }
  return parts;
}

/**
 * Generate an SVG path `d` attribute string from points using quadratic Bezier
 * curves through midpoints (smoothPath). Produces smooth, faithful rendering.
 *
 * For 0 points: empty string.
 * For 1 point: zero-length path at that point (renders as a round dot with round linecap).
 * For 2 points: straight line.
 * For 3+ points: M p0, then Q segments through midpoints.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  // 3+ points: quadratic midpoints approach
  let d = `M ${points[0].x} ${points[0].y}`;

  // Line to the midpoint between first and second point
  const mid0x = (points[0].x + points[1].x) / 2;
  const mid0y = (points[0].y + points[1].y) / 2;
  d += ` L ${mid0x} ${mid0y}`;

  // Quadratic curves through midpoints
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  // Line from last midpoint to last point
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}
