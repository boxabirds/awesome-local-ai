import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker polyline simplification (iterative, explicit stack —
 * no recursion, safe for 5,000+ points).
 *
 * Keeps the first and last points and guarantees every removed point lies
 * within `tolerance` of the resulting polyline. Deterministic.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Split a long point list into consecutive parts of at most `max` points.
 * Consecutive parts share their join point (part k+1 starts where part k
 * ends), so strokes built from the parts join seamlessly.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  if (points.length <= max) return [points.map((p) => ({ x: p.x, y: p.y }))];
  const parts: Point[][] = [];
  let i = 0;
  for (;;) {
    const end = Math.min(i + max, points.length);
    parts.push(points.slice(i, end).map((p) => ({ x: p.x, y: p.y })));
    if (end >= points.length) break;
    i = end - 1; // share the join point
  }
  return parts;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * SVG path through `points` using quadratic midpoint smoothing:
 * `M p0`, then `Q p[i] mid(p[i], p[i+1])` for each interior point, ending
 * at the last point. A single point produces a zero-length path (rendered
 * as a round dot with a round line cap). Deterministic.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  }
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${fmt(points[i].x)} ${fmt(points[i].y)} ${fmt(mx)} ${fmt(my)}`;
  }
  d += ` L ${fmt(points[n - 1].x)} ${fmt(points[n - 1].y)}`;
  return d;
}
