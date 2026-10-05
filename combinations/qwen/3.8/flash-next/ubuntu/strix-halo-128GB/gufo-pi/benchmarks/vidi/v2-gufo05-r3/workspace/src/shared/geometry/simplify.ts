/**
 * Stroke geometry (story 11).
 *
 * `simplify` implements Ramer–Douglas–Peucker, `splitPoints` chunks a drag at
 * `STROKE_MAX_POINTS` with a shared join point, and `smoothPath` turns points
 * into an SVG path of midpoint quadratic curves. See the module body for the
 * guarantees each one makes.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

function squaredDistance(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  // Squared distance to the *segment* a-b (the same rule as
  // `distanceToSegment`): measuring against the infinite line would let a
  // point that bows past an endpoint look close while it is far from the
  // kept polyline, breaking the one-pixel guarantee on looped strokes.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return dx * dx + dy * dy;
}

/**
 * Ramer–Douglas–Peucker simplification.
 *
 * Every input point lies at most `tolerance` away from the returned polyline
 * (that is the property `pen.smooth` rests on: called with
 * `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, no drawn point ends up more than one
 * *screen* pixel from the finished stroke). The first and last points are
 * always kept, so consecutive parts join exactly.
 *
 * Iterative with an explicit stack: a recording can hold `STROKE_MAX_POINTS`
 * points, and a recursive implementation would risk a stack overflow on a
 * worst-case (maximally wiggly) input.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2 || !(tolerance > 0)) return points.map((p) => ({ x: p.x, y: p.y }));

  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const span = stack.pop();
    if (!span) break;
    const [first, last] = span;
    if (last - first < 2) continue;
    const a = points[first];
    const b = points[last];
    let worst = -1;
    let worstDistance = tol2;
    for (let i = first + 1; i < last; i++) {
      const d = squaredDistance(points[i], a, b);
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst === -1) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}

/**
 * Chunk a recording into strokes of at most `max` points.
 *
 * Consecutive parts share their join point (`part[i+1][0] === part[i].last`),
 * which is what lets a split long stroke render with no visible gap, and it is
 * what the boundary tests pin down: `max - 1` points stay one part, `max` stay
 * one part, `max + 1` become two.
 */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  const size = Math.max(2, Math.floor(max));
  if (points.length === 0) return [];
  if (points.length <= size) return [points.map((p) => ({ x: p.x, y: p.y }))];
  const parts: Point[][] = [];
  const step = size - 1; // the shared join point shifts every window by one
  for (let start = 0; start < points.length - 1; start += step) {
    const part = points.slice(start, Math.min(start + size, points.length));
    parts.push(part.map((p) => ({ x: p.x, y: p.y })));
  }
  return parts;
}

/**
 * The SVG path through `points`: an `M` move, then one quadratic segment per
 * interior point using it as the control point and the midpoint to the next as
 * the anchor, finishing with an `L` at the last point.
 *
 * Each curve passes through the midpoints of consecutive segments and stays
 * inside their convex hull, so the drawn curve never strays further from the
 * simplified polyline than the simplified polyline strays from the hand — the
 * second half of the "within one screen pixel" argument (`pen.smooth`).
 *
 * One point yields a zero-length stroke: with `stroke-linecap: round` that
 * paints a dot of exactly the stroke width (`pen.dot`).
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p = (point: Point): string => `${point.x} ${point.y}`;
  if (n === 1) {
    const only = points[0];
    return `M ${p(only)} L ${p(only)}`;
  }
  if (n === 2) return `M ${p(points[0])} L ${p(points[1])}`;
  let d = `M ${p(points[0])}`;
  for (let i = 1; i < n - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const mid = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
    d += ` Q ${p(current)} ${p(mid)}`;
  }
  d += ` L ${p(points[n - 1])}`;
  return d;
}
