import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

function segDistance(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker: every input point lies within `tolerance` of the result polyline; first and last are kept. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDistance(points[lo], points[hi], points[i]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([lo, at], [at, hi]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

/** Parts of at most `max` points; each part after the first starts with the previous part's last point. */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + max, points.length);
    parts.push(points.slice(start, end));
    if (end >= points.length) break;
    start = end - 1;
  }
  return parts;
}

const f = (n: number) => String(Math.round(n * 100) / 100);

/** SVG path through the points: quadratic curves with the points as controls and segment midpoints as ends. */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0];
  if (points.length === 1) return `M${f(p0.x)} ${f(p0.y)}L${f(p0.x)} ${f(p0.y)}`;
  if (points.length === 2) return `M${f(p0.x)} ${f(p0.y)}L${f(points[1].x)} ${f(points[1].y)}`;
  let d = `M${f(p0.x)} ${f(p0.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i];
    const n = points[i + 1];
    d += `Q${f(c.x)} ${f(c.y)} ${f((c.x + n.x) / 2)} ${f((c.y + n.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${d}L${f(last.x)} ${f(last.y)}`;
}
