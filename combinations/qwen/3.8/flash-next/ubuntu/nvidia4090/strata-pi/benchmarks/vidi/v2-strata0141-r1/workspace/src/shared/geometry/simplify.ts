import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/**
 * Stroke geometry (`stroke.model`, `pen.smooth`, `pen.long_stroke`).
 *
 * Three pure functions, no DOM and no Y.Doc, so a recorded pointer path can be
 * tested exactly as the pen produces it:
 *
 * - `simplify` - Ramer–Douglas–Peucker. It drops the points a line does not need
 *   and keeps the ones it does, with a guarantee that matters: **every point that
 *   was drawn lies within `tolerance` of the result**. That guarantee *is*
 *   `pen.smooth` - the pen calls it with `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, so
 *   a finished stroke never strays more than one screen pixel from what the hand
 *   moved (`TC-01`, `TC-02`).
 * - `splitPoints` - the point limit of `pen.long_stroke`, cut into consecutive
 *   parts that **share their join point**, so two strokes meet with no gap.
 * - `smoothPath` - the SVG path a stroke is drawn with: midpoint quadratics,
 *   which bend the polyline without ever leaving it.
 */

const isFinitePoint = (point: unknown): point is Point => {
  if (typeof point !== 'object' || point === null) {
    return false;
  }
  const candidate = point as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x) && typeof candidate.y === 'number' && Number.isFinite(candidate.y);
};

/** The points this maths can actually work with: usable, and in order. */
function usablePoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points ?? []) {
    if (isFinitePoint(point)) {
      out.push({ x: point.x, y: point.y });
    }
  }
  return out;
}

/**
 * Shortest distance from `p` to the segment `a`-`b`, clamped to the segment.
 * The same rule `distanceToPolyline` uses, so "how far from this line" means the
 * same thing everywhere on the board.
 */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/**
 * Ramer–Douglas–Peucker, iteratively (`pen.smooth`).
 *
 * **Iterative on purpose**: a 5,000-point stroke (`STROKE_MAX_POINTS`) recursion
 * would have to survive the depth the split happens to produce, and an explicit
 * stack cannot overflow. The two endpoints always stay, and each sub-path keeps
 * the point furthest from its chord until nothing is further away than
 * `tolerance` - which is what makes the result faithful rather than merely
 * shorter: the interval a point belongs to when the loop finishes has exactly its
 * two neighbouring kept points as ends, so that point is within `tolerance` of the
 * polyline that is finally drawn.
 *
 * A tolerance of 0 (or a non-finite one) keeps every point that changes the line
 * at all. Non-finite points are dropped rather than throwing: a recorded path is
 * user input, and user input is never an exception here.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const raw = usablePoints(points);
  const count = raw.length;
  if (count <= 2) {
    return raw;
  }
  const toleranceUsable = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;

  // Each entry is a sub-path whose two ends are already decided.
  const stack: number[] = [0, count - 1];
  while (stack.length > 0) {
    const end = stack.pop()!;
    const start = stack.pop()!;
    if (end <= start + 1) {
      continue;
    }
    let furthest = -1;
    let furthestDistance = 0;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegment(raw[start]!, raw[end]!, raw[index]!);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthest = index;
      }
    }
    if (furthest === -1 || furthestDistance <= toleranceUsable) {
      continue; // everything in here is close enough to the chord
    }
    keep[furthest] = 1;
    stack.push(start, furthest, furthest, end);
  }

  const result: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    if (keep[index] === 1) {
      result.push(raw[index]!);
    }
  }
  return result;
}

/**
 * Cut a recorded path into strokes of at most `max` points (`pen.long_stroke`).
 *
 * The parts **share their join point**: part 2 begins with part 1's last point, so
 * when the two are drawn one after the other there is nowhere for a gap to appear
 * and no point of what was drawn is thrown away (`TC-03`).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const raw = usablePoints(points);
  if (raw.length === 0) {
    return [];
  }
  const limit = Number.isInteger(max) && max >= 2 ? max : STROKE_MAX_POINTS;

  const parts: Point[][] = [];
  let start = 0;
  while (start < raw.length) {
    const end = Math.min(start + limit - 1, raw.length - 1);
    parts.push(raw.slice(start, end + 1));
    if (end >= raw.length - 1) {
      break;
    }
    start = end; // the last point of this part is the first point of the next
  }
  return parts;
}

/** A path number with three decimals: stable text, far finer than a pixel. */
const n = (value: number): string => String(Number(value.toFixed(3)));

/**
 * The `d` attribute a stroke is drawn with (`pen.smooth`, `pen.render`).
 *
 * `M` at the first point, then one quadratic per middle point, each curve ending
 * at the midpoint of the two segments it bends - the standard midpoint smoothing.
 * A quadratic lies inside the hull of its endpoints and control point, so bending
 * a simplified polyline this way never takes the drawn line further from the
 * recorded path than the simplification already allowed.
 *
 * The last point is reached exactly, because it is where the person stopped.
 * One point - a click, `pen.dot` - becomes a zero-length path, which round caps
 * paint as a dot the size of the thickness.
 */
export function smoothPath(points: readonly Point[]): string {
  const raw = usablePoints(points);
  if (raw.length === 0) {
    return '';
  }
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  if (raw.length === 1) {
    return `M ${n(first.x)} ${n(first.y)} L ${n(last.x)} ${n(last.y)}`;
  }
  let d = `M ${n(first.x)} ${n(first.y)}`;
  for (let index = 1; index < raw.length - 1; index += 1) {
    const current = raw[index]!;
    const next = raw[index + 1]!;
    d += ` Q ${n(current.x)} ${n(current.y)} ${n((current.x + next.x) / 2)} ${n((current.y + next.y) / 2)}`;
  }
  d += ` L ${n(last.x)} ${n(last.y)}`;
  return d;
}
