/**
 * Freehand stroke geometry (story 11): simplification, splitting of very long strokes and the
 * smooth SVG path a stroke is drawn with. World units, pure.
 */
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

const HALF = 2;
/** Path coordinates are written with at most this many decimals (sub-pixel at any zoom). */
const PATH_DECIMALS = 3;
const PATH_SCALE = 10 ** PATH_DECIMALS;

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker simplification. Keeps the first and last point; every input point lies
 * within `tolerance` of the returned polyline (distance to the segment, not the infinite line,
 * so the guarantee holds for loops and back-tracking too). Iterative (explicit stack), so
 * STROKE_MAX_POINTS-long inputs never hit a recursion limit. Returns a copy.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
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
    if (worstIndex >= 0 && worst > tol) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push({ x: points[i]!.x, y: points[i]!.y });
  return out;
}

/**
 * Splits a point list into consecutive parts of at most `max` points (default
 * STROKE_MAX_POINTS). Each part after the first starts with the previous part's last point, so
 * the strokes join without a gap. A list of at most `max` points is one part; empty gives none.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  const size = Math.max(2, Math.floor(max));
  if (points.length <= size) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + size - 1, points.length - 1);
    parts.push(points.slice(start, end + 1));
    start = end;
  }
  return parts;
}

function fmt(n: number): string {
  const r = Math.round(n * PATH_SCALE) / PATH_SCALE;
  return String(Object.is(r, -0) ? 0 : r);
}

function pt(p: Point): string {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}

/**
 * The SVG path a stroke is drawn with: `M p0`, then a quadratic curve through each inner point
 * to the midpoint of it and the next (`Q p[i] mid(p[i], p[i+1])`), then a line to the last
 * point. One point gives a zero-length path (a round dot with round line caps); two points a
 * straight line. Deterministic; empty input gives ''.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const first = points[0]!;
  if (n === 1) return `M ${pt(first)} L ${pt(first)}`;
  const parts = [`M ${pt(first)}`];
  for (let i = 1; i < n - 1; i += 1) {
    const p = points[i]!;
    const next = points[i + 1]!;
    parts.push(`Q ${pt(p)} ${pt({ x: (p.x + next.x) / HALF, y: (p.y + next.y) / HALF })}`);
  }
  parts.push(`L ${pt(points[n - 1]!)}`);
  return parts.join(' ');
}
