import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';
import { distanceToSegment } from './polyline';

/**
 * Turn a recorded pointer path into a simpler one (story 11).
 *
 * `simplify` is Ramer–Douglas–Peucker: the one guarantee the PRD asks for
 * (`pen.smooth`) is that no point of the finished stroke lies farther than
 * `tolerance` from the path that was drawn — and, the other way round, that no point
 * the user drew lies farther than `tolerance` from the result. Both fall out of the
 * algorithm, which is why the tolerance is simply the drawing budget in world units:
 * `STROKE_SIMPLIFY_TOLERANCE_PX` divided by the zoom the stroke was drawn at, so it
 * stays one *screen* pixel whatever the zoom was.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map(clone);
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const tolSq = tol * tol;
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  // An explicit stack rather than recursion: a stroke can legally hold
  // STROKE_MAX_POINTS points, and 5,000 nested calls is not something to bet on.
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const span = stack.pop()!;
    const first = span[0];
    const last = span[1];
    let worstIndex = -1;
    let worstDistanceSq = 0;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[first], points[last], points[i]);
      const distanceSq = distance * distance;
      if (distanceSq > worstDistanceSq) {
        worstDistanceSq = distanceSq;
        worstIndex = i;
      }
    }
    // Nothing further out than the budget: every point between the ends is inside it.
    if (worstIndex >= 0 && worstDistanceSq > tolSq) {
      keep[worstIndex] = true;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(clone(points[i]));
  return out;
}

/**
 * Split a long recorded path into parts of at most `max` points. Consecutive parts
 * share their join point, so drawing them one after another leaves no gap
 * (PRD `pen.long_stroke`).
 */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  const size = Number.isFinite(max) && max >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  const out: Point[][] = [];
  if (points.length === 0) return out;
  let start = 0;
  // Each part after the first begins with the point the previous part ended on: one
  // point is counted twice, and that is exactly what makes the two halves join.
  while (points.length - start > size) {
    out.push(points.slice(start, start + size).map(clone));
    start += size - 1;
  }
  out.push(points.slice(start).map(clone));
  return out;
}

/**
 * The SVG path of a stroke: midpoint quadratic curves through the points, which is
 * what makes a handwritten line look drawn rather than faceted. Each curve passes
 * through the midpoints of two consecutive segments and stays inside their hull, so
 * smoothing the drawing this way keeps it within the tolerance the points were
 * simplified to (PRD `pen.smooth`).
 *
 * A single point becomes a zero-length path, which a round line cap turns into a dot
 * of the ink's own width (PRD `pen.dot`).
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) {
    const only = points[0];
    return `M ${num(only.x)} ${num(only.y)} L ${num(only.x)} ${num(only.y)}`;
  }
  let d = `M ${num(points[0].x)} ${num(points[0].y)}`;
  if (n === 2) {
    d += ` L ${num(points[1].x)} ${num(points[1].y)}`;
    return d;
  }
  for (let i = 1; i < n - 1; i++) {
    const control = points[i];
    const next = points[i + 1];
    d += ` Q ${num(control.x)} ${num(control.y)} ${num((control.x + next.x) / 2)} ${num((control.y + next.y) / 2)}`;
  }
  const last = points[n - 1];
  d += ` L ${num(last.x)} ${num(last.y)}`;
  return d;
}

function clone(p: Point): Point {
  return { x: p.x, y: p.y };
}

/** Three decimals of a coordinate: sub-thousandth of a board unit, and stable text. */
function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  // Never "-0": a path should read the same after a round trip through the document.
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
