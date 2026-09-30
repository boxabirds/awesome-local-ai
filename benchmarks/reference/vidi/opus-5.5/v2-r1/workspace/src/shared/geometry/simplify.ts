// Pen stroke geometry (story 11): Ramer-Douglas-Peucker simplification, splitting of very long
// strokes and the smoothed SVG path. Framework-free.
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';
import { distanceToPolyline } from './polyline';

/**
 * Ramer-Douglas-Peucker: keeps the first and last point and every point needed so that each
 * input point lies within `tolerance` of the result's polyline. Iterative (explicit stack), so
 * long strokes cannot exhaust the call stack.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstIndex = -1;
    const segment = [points[first], points[last]];
    for (let i = first + 1; i < last; i++) {
      const d = distanceToPolyline(segment, points[i]);
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex !== -1 && worst > tolerance) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

/**
 * Splits points into parts of at most `max` points; each part after the first starts with the
 * previous part's last point, so consecutive parts join without a gap.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const size = Math.max(2, Math.floor(max));
  if (points.length <= size) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + size, points.length);
    parts.push(points.slice(start, end));
    if (end >= points.length) break;
    start = end - 1;
  }
  return parts;
}

const num = (v: number) => String(Math.round(v * 100) / 100);
const pt = (p: Point) => `${num(p.x)} ${num(p.y)}`;

/**
 * SVG path through the points: straight to the first midpoint, quadratic curves with each inner
 * point as control ending at the midpoint of the next segment, and straight to the last point.
 * One point gives a zero-length path (a round dot with round caps).
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pt(points[0])} L ${pt(points[0])}`;
  if (n === 2) return `M ${pt(points[0])} L ${pt(points[1])}`;
  const parts = [`M ${pt(points[0])}`];
  for (let i = 1; i < n - 1; i++) {
    const c = points[i];
    const next = points[i + 1];
    const end = i === n - 2 ? next : { x: (c.x + next.x) / 2, y: (c.y + next.y) / 2 };
    parts.push(`Q ${pt(c)} ${pt(end)}`);
  }
  return parts.join(' ');
}
