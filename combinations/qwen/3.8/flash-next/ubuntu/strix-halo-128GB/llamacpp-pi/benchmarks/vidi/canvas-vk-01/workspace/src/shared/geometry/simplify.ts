import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker polyline simplification (iterative, no recursion depth
 * risk). Every point of the input is guaranteed to be within `tolerance` of the
 * result polyline. Keeps first and last points.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative RDP with an explicit stack of (start, end) index pairs.
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    let maxDist = 0;
    let maxIndex = start;

    const ax = points[start]!.x;
    const ay = points[start]!.y;
    const bx = points[end]!.x;
    const by = points[end]!.y;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    for (let i = start + 1; i < end; i += 1) {
      const px = points[i]!.x;
      const py = points[i]!.y;
      let dist: number;
      if (lenSq === 0) {
        dist = Math.hypot(px - ax, py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex]);
      stack.push([maxIndex, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) result.push(points[i]!);
  }
  return result;
}

/**
 * Split a point array into consecutive parts of at most `max` points, where
 * each part after the first starts with the last point of the previous part
 * (a shared join point so there is no visible gap).
 *
 * Returns a single-element array when `points.length <= max`.
 */
export function splitPoints(points: readonly Point[], max = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [[...points]];
  const parts: Point[][] = [];
  let offset = 0;
  while (offset < points.length) {
    const end = Math.min(offset + max, points.length);
    parts.push([...points.slice(offset, end)]);
    if (end >= points.length) break;
    // Next part starts with the last point of this one.
    offset = end - 1;
  }
  return parts;
}

/**
 * Generate an SVG path `d` string from the given points using quadratic Bézier
 * curves through midpoints. Produces a smooth polyline with rounded joins.
 *
 * - 0 points → empty string.
 * - 1 point → zero-length moveto (round dot with round linecap).
 * - 2 points → straight line.
 * - 3+ points → M then Q segments through midpoints, ending at the last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[0]!.x} ${points[0]!.y}`;
  }
  if (points.length === 2) {
    const a = points[0]!;
    const b = points[1]!;
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  // Quadratic through midpoints:
  // M p0 Q p0 mid(p0,p1) Q p1 mid(p1,p2) ... Q p[n-1] p[n-1]
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const curr = points[i]!;
    const next = points[i + 1]!;
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
  }
  // Final segment: Q to the actual last point (control = last point)
  const last = points[points.length - 1]!;
  d += ` Q ${last.x} ${last.y} ${last.x} ${last.y}`;
  return d;
}
