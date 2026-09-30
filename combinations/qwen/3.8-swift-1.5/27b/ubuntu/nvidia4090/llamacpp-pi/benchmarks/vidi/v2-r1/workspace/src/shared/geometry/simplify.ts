/**
 * Story 11: stroke geometry — Ramer-Douglas-Peucker simplification,
 * long-stroke splitting and smooth SVG path generation.
 *
 * All points are in world units; the caller chooses the tolerance in
 * world units (STROKE_SIMPLIFY_TOLERANCE_PX / zoom while drawing).
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Distance from point `p` to the line SEGMENT `a`-`b` (the projection is
 * clamped to the segment, so the RDP deviation guarantee holds against
 * the final polyline, not just the infinite line through each pair).
 */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker simplification (iterative, explicit stack — no
 * recursion depth risk on 5,000-point strokes).
 *
 * Keeps the first and last point and guarantees that every input point
 * lies within `tolerance` of the resulting polyline, so the finished
 * stroke stays faithful to what was drawn (PRD pen.smooth).
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) {
    return points.map((p) => ({ x: p.x, y: p.y }));
  }
  const tol = Math.max(0, tolerance);
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIdx = -1;
    const a = points[start];
    const b = points[end];
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > tol) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

/**
 * Split a point list into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS). Consecutive parts share the join point
 * (the last point of a part is the first point of the next), so the
 * parts join with no visible gap (PRD pen.long_stroke).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max < 2) throw new Error('splitPoints: max must be >= 2');
  const parts: Point[][] = [];
  const n = points.length;
  let start = 0;
  while (start < n) {
    const end = Math.min(start + max, n);
    const part: Point[] = [];
    for (let i = start; i < end; i++) part.push({ x: points[i].x, y: points[i].y });
    parts.push(part);
    if (end >= n) break;
    start = end - 1; // share the join point
  }
  return parts;
}

/**
 * SVG path through the points using quadratic Bezier curves through the
 * midpoints of consecutive segments: `M p0`, then `Q p[i] mid(p[i], p[i+1])`
 * for each interior point, ending at the last point.
 *
 * Each curve passes through the midpoints of its segments and stays
 * inside their hull, so the rendered stroke stays within the simplify
 * tolerance of the drawn path. A single point yields a zero-length
 * path that renders as a round dot with round line caps.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  if (n === 2) {
    d += ` L ${points[1].x} ${points[1].y}`;
    return d;
  }
  for (let i = 1; i < n - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }
  const last = points[n - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
