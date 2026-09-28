import type { Point } from './index';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker polyline simplification (iterative, no recursion depth risk).
 * Guarantees every input point lies within `tolerance` of the output polyline.
 * Keeps first and last points.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const n = points.length;
  const keep: boolean[] = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  // Iterative RDP using an explicit stack
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    let maxDist = 0;
    let maxIdx = start;

    const ax = points[start].x;
    const ay = points[start].y;
    const bx = points[end].x;
    const by = points[end].y;
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;

    for (let i = start + 1; i < end; i++) {
      let d: number;
      if (lenSq === 0) {
        const dx = points[i].x - ax;
        const dy = points[i].y - ay;
        d = Math.sqrt(dx * dx + dy * dy);
      } else {
        let t = ((points[i].x - ax) * abx + (points[i].y - ay) * aby) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = ax + t * abx;
        const projY = ay + t * aby;
        const dx = points[i].x - projX;
        const dy = points[i].y - projY;
        d = Math.sqrt(dx * dx + dy * dy);
      }
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

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Split points into chunks of at most `max` points each.
 * Consecutive parts share the join point (last of part N = first of part N+1).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [[...points]];

  const parts: Point[][] = [];
  // Each chunk gets (max - 1) new points + 1 shared join point, except the first chunk which gets max points
  // Strategy: first chunk = points[0..max-1], second chunk = points[max-1..2*max-2], etc.
  let idx = 0;
  while (idx < points.length) {
    const end = Math.min(idx + max, points.length);
    parts.push(points.slice(idx, end).map(p => ({ ...p })));
    if (end >= points.length) break;
    // Next part starts at the last point of current part (shared join point)
    idx = end - 1;
  }
  return parts;
}

/**
 * Generate an SVG path string using quadratic Bezier curves through midpoints.
 * For 0 points: empty string. For 1 point: zero-length path (renders as a round dot with round linecap).
 * For 2+ points: M p0, then Q segments through midpoints, ending at last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  // Final segment: quadratic to the last point
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  d += ` Q ${prev.x} ${prev.y} ${last.x} ${last.y}`;

  return d;
}
