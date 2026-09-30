import type { Point } from '@shared/geometry';
import { STROKE_MAX_POINTS } from '@shared/config';

/**
 * Ramer-Douglas-Peucker line simplification (iterative, no recursion depth risk).
 * Keeps first and last points. Guarantees max deviation ≤ tolerance.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative RDP using explicit stack
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
      const px = points[i].x;
      const py = points[i].y;
      let dist: number;
      if (lenSq === 0) {
        // start and end are the same point
        const ex = px - ax;
        const ey = py - ay;
        dist = Math.sqrt(ex * ex + ey * ey);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        const ex = px - cx;
        const ey = py - cy;
        dist = Math.sqrt(ex * ex + ey * ey);
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
 * Consecutive parts share the join point (part N+1 starts with part N's last point).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [[...points]];

  const parts: Point[][] = [];
  let i = 0;
  while (i < points.length) {
    if (i === 0) {
      parts.push([...points.slice(0, max)]);
      i = max - 1; // next part starts at the last point of this part
    } else {
      const end = Math.min(i + max, points.length);
      parts.push([...points.slice(i, end)]);
      i = end - 1;
      if (i >= points.length - 1) break;
    }
  }
  return parts;
}

/**
 * Generate an SVG path string using quadratic Bezier curves through midpoints.
 * For a single point, returns a zero-length path (for round dot rendering).
 * For two points, a straight line.
 * For 3+ points: M start, then Q control-point midpoints..., L last.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  // Start at first point
  let d = `M ${points[0].x} ${points[0].y}`;

  // Quadratic curves through midpoints
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  // Line to last point
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}
