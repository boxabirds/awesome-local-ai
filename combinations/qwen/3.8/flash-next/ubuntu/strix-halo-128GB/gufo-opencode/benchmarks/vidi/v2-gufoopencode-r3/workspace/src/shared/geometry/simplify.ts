import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

// Perpendicular distance from p to the segment a-b; mirrors the helper in
// polyline.ts so RDP and hit tests agree on the metric.
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer-Douglas-Peucker, iterative: keeps the endpoints and the point farthest
// from the chord whenever that distance exceeds the tolerance. Guarantees
// every raw point lies within `tolerance` of the result polyline.
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last - first < 2) continue;
    const a = points[first];
    const b = points[last];
    let worst = -1;
    let worstDist = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(a, b, points[i]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst === -1) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i] === 1) out.push({ ...points[i] });
  }
  return out;
}

// Splits a long capture into parts of at most `max` points; consecutive parts
// share their join point so the drawn line stays continuous.
export function splitPoints(points: readonly Point[], max = STROKE_MAX_POINTS): Point[][] {
  if (max < 1) throw new RangeError('splitPoints: max must be >= 1');
  const parts: Point[][] = [];
  let start = 0;
  while (points.length - start > max) {
    parts.push(points.slice(start, start + max).map((p) => ({ ...p })));
    start += max - 1;
  }
  parts.push(points.slice(start).map((p) => ({ ...p })));
  return parts;
}

// Midpoint-quadratic SVG path: `M p0` then `Q p[i] mid(p[i], p[i+1])` for the
// interior points, closing with a final Q through the last point. The curve
// passes through the midpoints of consecutive segments, so it stays inside
// their hull and faithful to the simplified polyline.
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const f = (v: number): string => String(Math.round(v * 100) / 100);
  const first = points[0];
  if (n === 1) return `M ${f(first.x)} ${f(first.y)} L ${f(first.x)} ${f(first.y)}`;
  if (n === 2) {
    return `M ${f(first.x)} ${f(first.y)} L ${f(points[1].x)} ${f(points[1].y)}`;
  }
  let d = `M ${f(first.x)} ${f(first.y)}`;
  for (let i = 1; i < n - 1; i++) {
    const c = points[i];
    const next = points[i + 1];
    const end = i === n - 2 ? next : { x: (c.x + next.x) / 2, y: (c.y + next.y) / 2 };
    d += ` Q ${f(c.x)} ${f(c.y)} ${f(end.x)} ${f(end.y)}`;
  }
  return d;
}
