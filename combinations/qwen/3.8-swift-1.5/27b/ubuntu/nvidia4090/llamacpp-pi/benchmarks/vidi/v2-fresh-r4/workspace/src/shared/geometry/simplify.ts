/**
 * Stroke geometry helpers (story 11):
 * - simplify: Ramer-Douglas-Peucker polyline simplification (iterative).
 * - splitPoints: split a long point list into chunks of max size sharing a join point.
 * - smoothPath: SVG path string using quadratic midpoint smoothing.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker simplification (iterative, no recursion depth risk).
 * Keeps first and last points. Guarantees every input point lies within
 * `tolerance` of the output polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  // Iterative RDP using an explicit stack.
  // keep[i] marks whether point i is retained.
  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Stack of [start, end] index pairs to process.
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    let maxDist = -1;
    let maxIdx = -1;

    const a = points[start];
    const b = points[end];

    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance && maxIdx > start) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/** Distance from point p to segment a-b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * Split a point list into consecutive parts of at most `max` points.
 * Each part after the first starts with the last point of the previous part
 * (the shared join point), so the parts connect seamlessly.
 *
 * E.g. max=3, 7 points → [p0,p1,p2,p3], [p3,p4,p5,p6]
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [[]];
  if (points.length <= max) return [[...points]];

  const parts: Point[][] = [];
  // First part: points[0] through points[max-1] (max points)
  parts.push([...points.slice(0, max)]);

  // Subsequent parts start at the last point of the previous part (shared join)
  let i = max - 1;
  while (i < points.length) {
    const end = Math.min(i + max, points.length);
    parts.push([...points.slice(i, end)]);
    i = end; // Advance past the end (no shared join for the next iteration since we're at the end)
  }

  return parts;
}

/**
 * Generate an SVG path string using quadratic Bezier curves through midpoints.
 * For a single point, produces a zero-length path (renders as a round dot with
 * round line caps).
 *
 * Algorithm: M p0, then for each consecutive pair (p[i], p[i+1]):
 *   Q p[i] midpoint(p[i], p[i+1])
 * ending at the last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // Zero-length path for a round dot
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
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
