// Pen stroke geometry (story 11): simplification, splitting and the smooth SVG path.
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker with an explicit stack (no recursion depth limit).
 * Keeps the first and last points; every input point lies within `tolerance`
 * of the resulting polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[first]!, points[last]!, points[i]!);
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
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push({ x: points[i]!.x, y: points[i]!.y });
  return out;
}

/**
 * Splits `points` into consecutive parts of at most `max` points; each part
 * after the first starts with the previous part's last point (seamless join).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const size = Math.max(2, Math.floor(max));
  if (points.length <= size) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + size, points.length);
    parts.push(points.slice(start, end));
    start = end - 1;
  }
  return parts;
}

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * SVG path through `points`: quadratic curves with each inner point as the
 * control point, ending at the midpoints of consecutive segments, then a line
 * to the last point. One point → a zero-length path (a dot with round caps).
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  if (points.length === 1) return `M ${n(first.x)} ${n(first.y)} L ${n(first.x)} ${n(first.y)}`;
  if (points.length === 2) return `M ${n(first.x)} ${n(first.y)} L ${n(points[1]!.x)} ${n(points[1]!.y)}`;
  let d = `M ${n(first.x)} ${n(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const next = points[i + 1]!;
    d += ` Q ${n(p.x)} ${n(p.y)} ${n((p.x + next.x) / 2)} ${n((p.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${n(last.x)} ${n(last.y)}`;
}
