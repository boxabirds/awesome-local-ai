import type { Point } from '../../client/canvas/camera';
import { STROKE_MAX_POINTS } from '../config';

/** Ramer–Douglas–Peucker simplification (iterative). Keeps first and last points. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  // Iterative RDP using an explicit stack of [startIdx, endIdx] intervals
  const stack: Array<{ start: number; end: number }> = [{ start: 0, end: points.length - 1 }];
  const kept = new Set<number>();
  kept.add(0);
  kept.add(points.length - 1);

  while (stack.length > 0) {
    const { start, end } = stack.pop()!;
    if (end - start < 2) continue;

    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[start], points[end], points[i]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance && maxIdx !== -1) {
      kept.add(maxIdx);
      stack.push({ start, end: maxIdx });
      stack.push({ start: maxIdx, end });
    }
  }

  // Sort and return
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (kept.has(i)) result.push(points[i]);
  }
  return result;
}

/** Distance from point p to segment a→b. */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/** Split a long polyline into chunks sharing the join point at each boundary. */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  if (points.length <= max) return [[...points]];

  const parts: Point[][] = [];
  let i = 0;

  while (i < points.length) {
    const end = Math.min(i + max, points.length);
    const chunk = [...points.slice(i, end)];

    // If this is not the first chunk, prepend the join point (last point of previous part)
    if (parts.length > 0 && chunk.length > 0) {
      const joinPoint = chunk[0];
      const prevLast = parts[parts.length - 1][parts[parts.length - 1].length - 1];
      if (prevLast.x !== joinPoint.x || prevLast.y !== joinPoint.y) {
        chunk.unshift(prevLast);
      }
    }

    parts.push(chunk);
    i = end;
  }

  return parts;
}

/** Create an SVG path string from smoothed midpoints of the line segments.
 *  For a single point returns an empty string (caller renders a dot separately).
 *  For multiple points returns "M x0 y0 Q x1 y1 sx sy ..." using quadratic curves through midpoints.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // Single point — zero-length path (dot will be rendered via stroke-width)
    return `M ${points[0].x} ${points[0].y}`;
  }

  // Build midpoint-driven quadratic Béziers
  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    const ex = points[i + 1].x;
    const ey = points[i + 1].y;
    d += ` Q ${midX} ${midY} ${ex} ${ey}`;
  }

  return d;
}
