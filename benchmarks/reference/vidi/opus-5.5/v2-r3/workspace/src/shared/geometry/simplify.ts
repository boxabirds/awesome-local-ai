// Freehand stroke geometry (story 11, stroke.model): simplification, splitting
// of very long strokes and the smoothed SVG path. World units.
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

const HALF = 2;
const PATH_DECIMALS = 2;

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker with an explicit stack (no recursion depth limit on
 * STROKE_MAX_POINTS points). Keeps the first and last point; every input point
 * lies within `tolerance` of the segment of the result that spans it.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstDist = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[first], points[last], points[i]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst !== -1 && worstDist > tolerance) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

/**
 * Splits a point list into parts of at most `max` points; each part after the
 * first starts with the previous part's last point, so the parts join with no gap.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [points.slice()];
  const parts: Point[][] = [];
  const step = Math.max(1, max - 1);
  for (let start = 0; start < points.length - 1; start += step) {
    parts.push(points.slice(start, Math.min(points.length, start + max)));
  }
  return parts;
}

function fmt(n: number): string {
  return String(Number(n.toFixed(PATH_DECIMALS)));
}

function xy(p: Point): string {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}

function toward(from: Point, to: Point, dist: number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return from;
  const k = Math.min(1, dist / len);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/**
 * SVG path through `points`: straight pieces joined by quadratic curves, each
 * with an interior point as its control. A curve starts and ends at most
 * `maxCut` from its corner (and never past the middle of a segment, so with
 * the default it runs midpoint to midpoint). Keeping `maxCut` small keeps the
 * rounded line close to the drawn one: a curve never strays more than
 * `maxCut / 2` from its corner. One point → a zero-length path, which round
 * caps draw as a dot.
 */
export function smoothPath(points: readonly Point[], maxCut = Infinity): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (points.length === 1) return `M ${xy(first)} L ${xy(first)}`;
  if (points.length === 2) return `M ${xy(first)} L ${xy(points[1])}`;
  let d = `M ${xy(first)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const p = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y) / HALF;
    const outLen = Math.hypot(next.x - p.x, next.y - p.y) / HALF;
    const a = toward(p, prev, Math.min(inLen, maxCut));
    const b = toward(p, next, Math.min(outLen, maxCut));
    d += ` L ${xy(a)} Q ${xy(p)} ${xy(b)}`;
  }
  return `${d} L ${xy(points[points.length - 1])}`;
}
