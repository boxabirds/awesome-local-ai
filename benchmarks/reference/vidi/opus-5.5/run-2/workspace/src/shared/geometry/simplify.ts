/**
 * Freehand stroke geometry (anchors: pen.smooth, pen.draw, pen.long_stroke). World units, pure.
 */
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

const HALF = 2;

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker: keeps the first and last point and every point needed so that
 * each input point lies within `tolerance` of the result (segment distance, so loops that
 * come back past their start are handled). Iterative, so 5,000 points never recurse deeply.
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
    for (let i = first + 1; i < last; i += 1) {
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
  for (let i = 0; i < points.length; i += 1) if (keep[i] === 1) out.push({ x: points[i]!.x, y: points[i]!.y });
  return out;
}

/**
 * Splits a point list into parts of at most `max` points; each part after the first starts
 * with the previous part's last point, so the drawn parts join without a gap.
 */
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

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * SVG path through the points: a line to the first midpoint, quadratic curves with each
 * inner point as control and the next midpoint as end, then a line to the last point.
 * One point is a zero-length path, drawn as a round dot by round line caps.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0]!;
  if (points.length === 1) return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x)} ${fmt(p0.y)}`;
  if (points.length === 2) {
    const p1 = points[1]!;
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / HALF, y: (a.y + b.y) / HALF });
  const m1 = mid(p0, points[1]!);
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(m1.x)} ${fmt(m1.y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const c = points[i]!;
    const m = mid(c, points[i + 1]!);
    d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt(m.x)} ${fmt(m.y)}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${fmt(last.x)} ${fmt(last.y)}`;
}
