import { STROKE_MAX_POINTS } from '../config';
import type { Point } from './index';
import { distanceToPolyline } from './polyline';

/** Ramer-Douglas-Peucker with an explicit stack. Keeps the first and last point; every input point ends within `tolerance` of the result. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const chord = [points[first], points[last]];
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToPolyline(chord, points[i]);
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1).map((p) => ({ ...p }));
}

/** Consecutive parts of at most `max` points; each part after the first starts with the previous part's last point. */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + max, points.length);
    parts.push(points.slice(start, end));
    if (end === points.length) break;
    start = end - 1;
  }
  return parts;
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const pt = (p: Point): string => `${fmt(p.x)} ${fmt(p.y)}`;

/** SVG path through quadratic curves whose end points are the midpoints of consecutive segments. */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (points.length === 1) return `M ${pt(first)} L ${pt(first)}`;
  if (points.length === 2) return `M ${pt(first)} L ${pt(points[1])}`;
  let d = `M ${pt(first)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    d += ` Q ${pt(points[i])} ${pt(mid)}`;
  }
  return `${d} L ${pt(points[points.length - 1])}`;
}
