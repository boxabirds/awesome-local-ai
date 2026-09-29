/**
 * Story 11: stroke simplification and path building (pen.smooth,
 * pen.long_stroke, pen.dot). Pure world-unit math — no doc, no DOM.
 *
 * - `simplify` is an iterative Ramer–Douglas–Peucker (explicit stack — no
 *   recursion-depth risk on 5,000 points): it keeps the first and last
 *   points and guarantees every discarded point lies within `tolerance` of
 *   the resulting polyline (smoothing stays faithful, pen.smooth).
 * - `splitPoints` chunks a long raw stroke into consecutive parts of at most
 *   `max` points; consecutive parts share the join point, so they render
 *   seamlessly (pen.long_stroke).
 * - `smoothPath` renders the simplified points as a smooth SVG path using
 *   quadratic curves through the midpoints (pen.draw); a single point is a
 *   zero-length path that a round line cap renders as a dot (pen.dot).
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker simplification. Every returned point is an input
 * point; every dropped input point is within `tolerance` of the output
 * polyline (the segment that replaces it joins two kept points).
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

/**
 * Splits `points` into consecutive parts of at most `max` points; part i+1
 * starts with part i's last point, so the parts join seamlessly.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max <= 1) return points.length === 0 ? [] : [points.map((p) => ({ x: p.x, y: p.y }))];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + max, points.length);
    parts.push(points.slice(start, end).map((p) => ({ x: p.x, y: p.y })));
    if (end === points.length) break; // exactly covered — no extra join part
    start = end - 1; // next part reuses the join point
  }
  return parts;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * SVG path for the given points: `M p0`, then `Q p[i] mid(p[i], p[i+1])`
 * segments for every interior point, ending at the last point. Two points
 * render as a straight line; one point as a zero-length path (a round dot);
 * zero points as the empty string.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  if (n === 2) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${fmt(points[i].x)} ${fmt(points[i].y)} ${fmt(midX)} ${fmt(midY)}`;
  }
  d += ` L ${fmt(points[n - 1].x)} ${fmt(points[n - 1].y)}`;
  return d;
}
