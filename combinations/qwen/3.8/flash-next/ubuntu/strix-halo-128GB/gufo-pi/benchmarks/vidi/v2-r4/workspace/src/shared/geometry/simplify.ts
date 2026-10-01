/**
 * Stroke simplification, splitting and SVG path generation.
 * Used by the Pen tool (story 11) to smooth and render freehand strokes.
 */
import type { Point } from '../../client/canvas/camera';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker simplification (iterative, explicit stack).
 * Keeps first and last points. Guarantees every removed point lies within
 * `tolerance` of the result polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative RDP using an explicit stack of (start, end) index pairs
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    // Find the point farthest from the line start→end
    let maxDist = -1;
    let maxIdx = start;

    const sx = points[start]!.x;
    const sy = points[start]!.y;
    const ex = points[end]!.x;
    const ey = points[end]!.y;
    const dx = ex - sx;
    const dy = ey - sy;
    const lenSq = dx * dx + dy * dy;

    for (let i = start + 1; i < end; i++) {
      const px = points[i]!.x;
      const py = points[i]!.y;
      let dist: number;
      if (lenSq === 0) {
        dist = Math.hypot(px - sx, py - sy);
      } else {
        let t = ((px - sx) * dx + (py - sy) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = sx + t * dx;
        const projY = sy + t * dy;
        dist = Math.hypot(px - projX, py - projY);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]!);
  }
  return result;
}

/**
 * Split points into chunks of at most `max` points each, with consecutive
 * parts sharing the join point (last of previous = first of next).
 * Returns parts in order. If total ≤ max, returns a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.length > 0 ? [...points] : []];

  const parts: Point[][] = [];
  let offset = 0;
  while (offset < points.length) {
    if (offset === 0) {
      // First chunk: indices 0..max-1 (exactly max points)
      parts.push([...points.slice(offset, offset + max)]);
      // Next chunk starts at the last point of this one
      offset = max - 1;
    } else {
      // Subsequent chunks: start with the join point, take (max-1) more
      const end = Math.min(offset + max, points.length);
      parts.push([...points.slice(offset, end)]);
      if (end >= points.length) break;
      offset = end - 1;
    }
  }
  return parts;
}

/**
 * Generate an SVG path string using quadratic Bézier midpoint smoothing.
 * For a single point, returns a zero-length path (renders as a round dot).
 * For 2+ points: M start, then Q ctrl mid for each interior segment,
 * ending with L to the last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0]!;
    return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
  }
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i]!;
    const next = points[i + 1]!;
    // Midpoint between current and next
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
  }

  // Last segment: line to the final point
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;

  return d;
}
