/**
 * Story 11 · stroke geometry (design "Stroke model and geometry").
 *
 * A freehand sketch is recorded as hundreds of raw pointer points; almost all of
 * them say nothing a straight line could not say. This file turns that recording
 * into something worth storing and drawing:
 *
 *  - {@link simplify} — Ramer–Douglas–Peucker, run iteratively on an explicit
 *    stack so a 5,000-point gesture cannot blow the call stack. Every input
 *    point ends up within `tolerance` of the result (PRD `pen.smooth`), which is
 *    the property the unit tests pin.
 *  - {@link splitPoints} — the {@link STROKE_MAX_POINTS} chunking a single long
 *    drag needs, with the join point shared so the sketch does not break where it
 *    was split.
 *  - {@link smoothPath} — the SVG `d` string: midpoint quadratic curves, so a
 *    polyline of corners renders as a hand-drawn line.
 *
 * Pure maths, no DOM and no Yjs, so all three run in the Node test scope.
 */
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/** The perpendicular distance from `p` to the *line* through `a`→`b`. */
function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx);
  return cross / Math.sqrt(lengthSquared);
}

/** True when two consecutive points are the same place (to two decimals). */
function samePlace(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.005 && Math.abs(a.y - b.y) < 0.005;
}

/**
 * Ramer–Douglas–Peucker: drop the points a straight line already explains, keep
 * the first and the last, and never leave a raw point further than `tolerance`
 * from the result.
 *
 * A tolerance of 0 (or a non-finite one) copies the input: the caller asked for
 * no simplification. A run of identical points is still collapsed, because those
 * carry no deviation *or* information.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const copy = (): Point[] => points.map((p) => ({ x: p.x, y: p.y }));
  if (points.length < 3) return copy();
  if (!Number.isFinite(tolerance) || tolerance <= 0) return copy();

  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // An explicit stack of index pairs instead of recursion: a handwritten loop
  // nests hundreds deep, and a long spiral would otherwise exhaust the stack.
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const a = points[first];
    const b = points[last];
    let index = -1;
    let maxDistance = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToLine(points[i], a, b);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    // Within tolerance: the straight piece says it all, keep nothing between.
    if (index === -1 || maxDistance <= tolerance) continue;
    keep[index] = 1;
    stack.push([first, index]);
    stack.push([index, last]);
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i] !== 1) continue;
    const point = points[i];
    const previous = out[out.length - 1];
    // Keep the last point even when it repeats its neighbour (a dot is exactly
    // that case); only drop a repeat that is followed by something else.
    if (previous !== undefined && i < n - 1 && samePlace(previous, point)) continue;
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

/**
 * Chunk a recording into strokes of at most `max` points.
 *
 * Each part after the first *starts with the last point of the part before it*,
 * so the sketch reads as one continuous line even though it becomes two objects
 * (PRD `pen.long_stroke`). Exactly `max` points stay one part; `max + 1` is the
 * first case that splits.
 */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  if (points.length === 0) return [];
  const limit = Number.isFinite(max) && max >= 2 ? Math.floor(max) : 2;
  if (points.length <= limit) return [points.map((p) => ({ x: p.x, y: p.y }))];

  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + limit - 1, points.length - 1);
    // `end` is included, and is where the next part begins: the join point is
    // shared, not duplicated into a gap.
    parts.push(points.slice(start, end + 1).map((p) => ({ x: p.x, y: p.y })));
    if (end >= points.length - 1) break;
    start = end;
  }
  return parts;
}

/** One coordinate pair, rounded to two decimals for a stable, short `d`. */
function pair(x: number, y: number): string {
  const rx = Math.round(x * 100) / 100;
  const ry = Math.round(y * 100) / 100;
  return `${rx} ${ry}`;
}

/**
 * The SVG path for a sketched line: `M` at the first point, then a quadratic
 * curve through each point with its endpoint at the midpoint towards the next,
 * closing with a straight finish on the last point.
 *
 * Consecutive points that are the same place are dropped first (they would each
 * emit a degenerate segment). A single point becomes a zero-length line, which a
 * round line-cap paints as the dot a pen makes when it only touches down
 * (PRD `pen.dot`). Non-finite coordinates are skipped rather than poisoning the
 * whole path.
 */
export function smoothPath(points: readonly Point[]): string {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (usable.length === 0) return '';
  const first = usable[0];
  if (usable.length === 1) {
    return `M ${pair(first.x, first.y)} L ${pair(first.x, first.y)}`;
  }
  if (usable.length === 2) {
    const last = usable[1];
    return `M ${pair(first.x, first.y)} L ${pair(last.x, last.y)}`;
  }

  let d = `M ${pair(first.x, first.y)}`;
  for (let i = 1; i < usable.length - 1; i++) {
    const control = usable[i];
    const next = usable[i + 1];
    d += ` Q ${pair(control.x, control.y)} ${pair(
      (control.x + next.x) / 2,
      (control.y + next.y) / 2,
    )}`;
  }
  const last = usable[usable.length - 1];
  d += ` L ${pair(last.x, last.y)}`;
  return d;
}
