import { STROKE_MAX_POINTS } from '../config';
import type { Point } from './index';

function deviation(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker with an explicit stack; keeps the first and last point, every input point stays within `tolerance`. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = deviation(points[lo], points[hi], points[i]);
      if (d > worst) { worst = d; at = i; }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([lo, at], [at, hi]);
    }
  }
  return points.filter((_, i) => keep[i] === 1).map((p) => ({ ...p }));
}

/** Consecutive parts of at most `max` points; each part after the first starts with the previous part's last point. */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.slice()];
  const parts: Point[][] = [];
  for (let start = 0; start < points.length - 1; start += max - 1) {
    parts.push(points.slice(start, Math.min(points.length, start + max)));
  }
  return parts;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const HALF = 2;

/** SVG path through the points using quadratic curves between segment midpoints. */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0];
  if (points.length === 1) return `M${round(p0.x)} ${round(p0.y)}L${round(p0.x)} ${round(p0.y)}`;
  if (points.length === 2) return `M${round(p0.x)} ${round(p0.y)}L${round(points[1].x)} ${round(points[1].y)}`;
  let d = `M${round(p0.x)} ${round(p0.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i];
    const nx = points[i + 1];
    d += `Q${round(c.x)} ${round(c.y)} ${round((c.x + nx.x) / HALF)} ${round((c.y + nx.y) / HALF)}`;
  }
  const last = points[points.length - 1];
  return `${d}L${round(last.x)} ${round(last.y)}`;
}
