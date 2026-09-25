// Pen stroke geometry (story 11): simplification, splitting of very long strokes and the smoothed SVG path.
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker with an explicit stack (no recursion depth limit on STROKE_MAX_POINTS points). Keeps the
 * first and last point; every input point lies within `tolerance` of the returned polyline (pen.smooth).
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[first], points[last], points[i]);
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
 * Splits a point list into parts of at most `max` points; each part after the first starts with the previous
 * part's last point, so consecutive strokes join without a gap (pen.long_stroke).
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
 * SVG path through the points: quadratic curves with each inner point as the control point and the midpoints
 * between neighbours as the joins. One point gives a zero-length path (a round dot with round caps).
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pt(points[0])} L ${pt(points[0])}`;
  if (n === 2) return `M ${pt(points[0])} L ${pt(points[1])}`;
  let d = `M ${pt(points[0])}`;
  for (let i = 1; i < n - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    d += ` Q ${pt(points[i])} ${pt(mid)}`;
  }
  return `${d} L ${pt(points[n - 1])}`;
}

/** Straight-segment SVG path through the points (pen preview and stroke hit area). */
export function polylinePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  if (rest.length === 0) return `M ${pt(first)} L ${pt(first)}`;
  return `M ${pt(first)}${rest.map((p) => ` L ${pt(p)}`).join('')}`;
}
