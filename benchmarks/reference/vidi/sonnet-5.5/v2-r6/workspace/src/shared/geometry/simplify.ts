import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

const HALF = 2;

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker (iterative); keeps the first and last point, every dropped point stays within `tolerance`. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= HALF) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let worst = -1;
    let worstDist = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[first], points[last], points[i]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Chunks of at most `max` points; each part starts with the previous part's last point so they join. */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(points.length, start + max);
    parts.push(points.slice(start, end));
    start = end - 1;
  }
  return parts;
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

/** SVG path through the points as quadratic curves between segment midpoints; a single point is a zero-length dot. */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0];
  if (n === 1) return `M${fmt(p0.x)} ${fmt(p0.y)}L${fmt(p0.x)} ${fmt(p0.y)}`;
  if (n === HALF) return `M${fmt(p0.x)} ${fmt(p0.y)}L${fmt(points[1].x)} ${fmt(points[1].y)}`;
  let d = `M${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i < n - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const mid = i === n - HALF ? q : { x: (p.x + q.x) / HALF, y: (p.y + q.y) / HALF };
    d += `Q${fmt(p.x)} ${fmt(p.y)} ${fmt(mid.x)} ${fmt(mid.y)}`;
  }
  return d;
}
