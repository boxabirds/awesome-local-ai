import { STROKE_MAX_POINTS } from "../config";
import type { Point } from "../geometry";

/**
 * Stroke geometry (`stroke.model`, story 11).
 *
 * Three small pure functions over a recorded drag:
 *
 * - `simplify` — Ramer–Douglas–Peucker. It throws away points the line does not
 *   need and keeps the ones it does. What makes it the right tool for
 *   `pen.smooth` is its guarantee: **every point of the input lies within
 *   `tolerance` of the output polyline**. Passing `STROKE_SIMPLIFY_TOLERANCE_PX /
 *   zoom` therefore means "no point of the finished stroke is more than one screen
 *   pixel away from the path the person drew, at the zoom they drew it at".
 * - `splitPoints` — cuts a recorded drag into consecutive parts that share their
 *   join point, which is what makes a 10,000-point stroke two strokes with no gap
 *   between them (`pen.long_stroke`).
 * - `smoothPath` — turns points into an SVG path of quadratic curves through the
 *   midpoints of consecutive segments. Each curve lies inside the hull of the two
 *   segments it replaces, so rounding the corners never pushes the drawn line
 *   outside what was drawn.
 *
 * No recursion: a 5,000-point drag on a nearly straight line would otherwise
 * recurse 5,000 frames deep, and the point limit exists precisely so that a drag
 * this long is possible.
 */

/** One stack frame of the iterative RDP: the stretch still to be checked. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * The RDP simplification of `points` at `tolerance` (board units).
 *
 * The first and last points are always kept — a stroke must start where the press
 * began and end where it was released. A tolerance of 0 (or a non-finite one)
 * returns a copy of the input unchanged.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length <= 2) return points.map(copy);
  if (!Number.isFinite(tolerance) || tolerance <= 0) return points.map(copy);

  const squared = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Span[] = [{ from: 0, to: points.length - 1 }];
  while (stack.length > 0) {
    const span = stack.pop()!;
    const a = points[span.from]!;
    const b = points[span.to]!;

    let worstIndex = -1;
    let worstSquared = 0;
    for (let index = span.from + 1; index < span.to; index += 1) {
      const distance = squaredDistanceToSegment(a, b, points[index]!);
      // Strictly greater: a point exactly `tolerance` away is inside the
      // tolerance and does not need keeping.
      if (distance > worstSquared) {
        worstSquared = distance;
        worstIndex = index;
      }
    }

    // Nothing sticks out further than the tolerance: this stretch is a straight
    // enough line already, and everything between its ends is within tolerance of
    // it by RDP's own property.
    if (worstIndex < 0 || worstSquared <= squared) continue;

    keep[worstIndex] = 1;
    if (span.to - worstIndex >= 2) stack.push({ from: worstIndex, to: span.to });
    if (worstIndex - span.from >= 2) stack.push({ from: span.from, to: worstIndex });
  }

  const result: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) result.push(copy(points[index]!));
  }
  return result;
}

/**
 * `points` cut into parts of at most `max` points (`STROKE_MAX_POINTS` by default).
 *
 * Each part after the first **starts with the point its predecessor ended on**, so
 * the strokes join seamlessly: drawn one after another they look like the single
 * drag they came from. Fewer points than `max` returns one part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const limit = Number.isFinite(max) && max >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  if (points.length <= limit) return [points.map(copy)];

  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    // Every part after the first re-uses the previous part's last point.
    const end = Math.min(start + limit - 1, points.length - 1);
    parts.push(points.slice(start, end + 1).map(copy));
    if (end >= points.length - 1) break;
    start = end;
  }
  return parts;
}

/**
 * The SVG `d` for `points`: a straight line to the first midpoint, then one
 * quadratic curve per interior point, each control point being that interior point
 * and each endpoint the midpoint of the segment after it, finishing on the last
 * point.
 *
 * A quadratic curve lies inside the triangle formed by its endpoints and control
 * point, so every curve stays inside the two segments it replaces — the drawn line
 * never wanders away from what was recorded.
 *
 * One point becomes a zero-length segment, which a round `stroke-linecap` renders
 * as a dot (`pen.dot`). No points is an empty string.
 */
export function smoothPath(points: readonly Point[]): string {
  if (!Array.isArray(points) || points.length === 0) return "";
  const parts: string[] = [`M ${coord(points[0]!.x)} ${coord(points[0]!.y)}`];

  if (points.length === 1) {
    // A zero-length subpath plus a round linecap is the dot.
    parts.push(`L ${coord(points[0]!.x)} ${coord(points[0]!.y)}`);
    return parts.join(" ");
  }

  if (points.length === 2) {
    parts.push(`L ${coord(points[1]!.x)} ${coord(points[1]!.y)}`);
    return parts.join(" ");
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    parts.push(`Q ${coord(current.x)} ${coord(current.y)} ${coord(midX)} ${coord(midY)}`);
  }
  const last = points[points.length - 1]!;
  parts.push(`L ${coord(last.x)} ${coord(last.y)}`);
  return parts.join(" ");
}

// ---- internals ------------------------------------------------------------

function copy(point: Point): Point {
  return { x: point.x, y: point.y };
}

/** Coordinates keep three decimals: enough for a board unit, short enough to read. */
function coord(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Squared distance from `point` to the segment `a`–`b`. */
function squaredDistanceToSegment(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const projectX = a.x + t * dx;
  const projectY = a.y + t * dy;
  return (point.x - projectX) ** 2 + (point.y - projectY) ** 2;
}
