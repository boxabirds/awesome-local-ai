import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

// Story 11: point-set reduction for recorded pen strokes.
// simplify() is Ramer-Douglas-Peucker (iterative to survive long strokes):
// every removed point stays within `tolerance` of the output polyline.

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2 || !(tolerance >= 0)) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last <= first + 1) continue;
    const a = points[first];
    const b = points[last];
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distanceToSegment(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i] === 1) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

// Split a capture longer than `max` into consecutive parts of at most `max`
// points; every part after the first starts with the previous part's last
// point so the drawn line stays connected (design pen.split).
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (!Number.isFinite(max) || max < 2) {
    throw new Error(`splitPoints: max must be a finite number >= 2, got ${String(max)}`);
  }
  const clone = (from: number, to: number): Point[] => {
    const part: Point[] = [];
    for (let i = from; i < to; i += 1) part.push({ x: points[i].x, y: points[i].y });
    return part;
  };
  if (points.length <= max) return [clone(0, points.length)];
  const parts: Point[][] = [];
  let cursor = 0;
  while (points.length - cursor > max) {
    parts.push(clone(cursor, cursor + max));
    cursor += max - 1;
  }
  parts.push(clone(cursor, points.length));
  return parts;
}

// Path data for rendering: M at the first point, then one quadratic per
// interior point using it as the control and the midpoint to the next point
// as the end, closing with a line to the final point. A single point becomes
// a zero-length segment so a round line-cap renders it as a dot.
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const first = points[0];
  if (n === 1) return `M ${first.x} ${first.y} L ${first.x} ${first.y}`;
  if (n === 2) {
    const second = points[1];
    return `M ${first.x} ${first.y} L ${second.x} ${second.y}`;
  }
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < n - 1; i += 1) {
    const p = points[i];
    const next = points[i + 1];
    const mx = (p.x + next.x) / 2;
    const my = (p.y + next.y) / 2;
    d += ` Q ${p.x} ${p.y} ${mx} ${my}`;
  }
  const last = points[n - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
