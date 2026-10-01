import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer–Douglas–Peucker simplification, iterative (explicit stack, no
 * recursion depth risk on 5,000-point strokes). Keeps the first and last
 * points and guarantees every input point lies within `tolerance` (in the
 * same units as the points) of the output polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  const tolSq = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let maxDistSq = -1;
    let idx = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const bx = points[b].x;
    const by = points[b].y;
    for (let i = a + 1; i < b; i++) {
      const dSq = distPointToSegmentSq(points[i], ax, ay, bx, by);
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        idx = i;
      }
    }
    if (maxDistSq > tolSq && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

function distPointToSegmentSq(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = p.x - ax;
  const apy = p.y - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    const dx = p.x - ax;
    const dy = p.y - ay;
    return dx * dx + dy * dy;
  }
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (ax + t * abx);
  const dy = p.y - (ay + t * aby);
  return dx * dx + dy * dy;
}

/**
 * Splits a long point list into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS). Consecutive parts share the join point:
 * part i+1 starts with part i's last point, so drawing can continue with no
 * visible gap.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  if (points.length <= max) return [points.map((p) => ({ x: p.x, y: p.y }))];

  const parts: Point[][] = [];
  const step = max - 1;
  for (let i = 0; i < points.length; i += step) {
    const end = Math.min(i + max, points.length);
    parts.push(
      points.slice(i, end).map((p) => ({ x: p.x, y: p.y })),
    );
  }
  return parts;
}

function fmt(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * SVG path through the points using midpoint quadratic curves: `M p0`, then
 * `Q p[i] mid(p[i], p[i+1])` for each interior point, ending at the last
 * point. Each curve passes through the midpoints of consecutive segments and
 * stays inside their hull, so the rendered stroke stays within the
 * simplification tolerance of the drawn path. A single point yields a
 * zero-length path (rendered as a round dot with round line caps).
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0];
  if (points.length === 1) {
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x)} ${fmt(p0.y)}`;
  }

  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${fmt(points[i].x)} ${fmt(points[i].y)} ${fmt(midX)} ${fmt(midY)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}
