import type { Point } from './types';

/**
 * Ramer-Douglas-Peucker simplification (iterative, explicit stack).
 * Keeps first and last points. Guarantees max deviation ≤ tolerance.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const len = points.length;
  if (len <= 2) return [...points];

  // Boolean flags indicating whether each point is "kept"
  const keep = new Uint8Array(len);
  keep[0] = 1; // Always keep first
  keep[len - 1] = 1; // Always keep last

  // Iterative RDP using an explicit stack of [startIdx, endIdx] ranges
  const stack: [number, number][] = [[0, len - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    // Find the point with the maximum perpendicular distance
    let maxDist = 0;
    let maxIdx = -1;
    const a = points[start];
    const b = points[end];

    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(a, b, points[i]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < len; i++) {
    if (keep[i]) {
      result.push(points[i]);
    }
  }

  return result;
}

/** Distance from point p to line segment ab. */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/**
 * Split points into chunks of `max` points each, sharing the join point between chunks.
 * Default max is STROKE_MAX_POINTS (5000).
 *
 * Example with max=3 and 5 points: [[p0,p1,p2], [p2,p3,p4]] — part 2 starts with p2
 *   (the last point of part 1 = first point of part 2, so they join seamlessly).
 */
export function splitPoints(
  points: readonly Point[],
  max: number = 5000,
): Point[][] {
  if (points.length <= max) {
    return [[...points]];
  }

  const parts: Point[][] = [];
  let offset = 0;

  while (offset < points.length) {
    const end = Math.min(offset + max, points.length);
    parts.push(Array.from(points.slice(offset, end)));

    // Move to the join point (last of current chunk) for the next chunk.
    // This ensures adjacent strokes share their endpoint so they join seamlessly.
    const nextOffset = end - 1;
    if (nextOffset < 0 || nextOffset >= points.length - 1) break;
    offset = nextOffset;
  }

  return parts;
}

/**
 * Create an SVG path string from a sequence of points using quadratic Bézier curves.
 * M p0, Q p1 mid(p0,p1), Q p2 mid(p1,p2), ... ending at the last point.
 * Single point → zero-length path "M x y".
 */
export function smoothPath(points: readonly Point[]): string {
  const len = points.length;
  if (len === 0) return '';
  if (len === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < len; i++) {
    const p = points[i];
    const midX = (points[i - 1].x + p.x) / 2;
    const midY = (points[i - 1].y + p.y) / 2;
    d += ` Q ${midX} ${midY} ${p.x} ${p.y}`;
  }

  return d;
}
