/**
 * Stroke geometry utilities (story 11).
 * Ramer-Douglas-Peucker simplification, splitting, and SVG path generation.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker polyline simplification (iterative to avoid stack overflow).
 * Keeps first and last points. Guarantees every removed point is within `tolerance` of the result.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative RDP using an explicit stack
  const stack: [number, number][] = [[0, points.length - 1]];

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
        const px = ax + t * dx;
        const py = ay + t * dy;
        dist = Math.hypot(points[i].x - px, points[i].y - py);
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
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Split points into chunks of at most `max` points.
 * Parts share the join point: the last point of part N equals the first of part N+1.
 * Default max is STROKE_MAX_POINTS.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.length > 0 ? [...points] : []];

  const parts: Point[][] = [];
  let offset = 0;
  while (offset < points.length) {
    const end = Math.min(offset + max, points.length);
    parts.push([...points.slice(offset, end)]);
    if (end >= points.length) break;
    // Next part starts at the last point of the current part (shared join)
    offset = end - 1;
  }
  return parts;
}

/**
 * Generate an SVG path string using quadratic Bézier curves through midpoints.
 * Single point → zero-length path (renders as a round dot with round linecap).
 * Two points → straight line M...L.
 * Three or more → M p0 then Q segments through midpoints.
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

  // End at the last point
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}
