// The stroke geometry (story 11 `stroke.model`): the three pure functions the Pen tool
// and the stroke component are built out of.
//
//   simplify   — Ramer–Douglas–Peucker: throw away the points a screen pixel cannot see,
//                keeping every recorded point within `tolerance` of what is left. That
//                bound is the whole smoothing promise (pen.smooth): the finished stroke is
//                smoother than what was drawn, never a different shape.
//   splitPoints — cut a stroke that outgrew STROKE_MAX_POINTS into consecutive strokes
//                that share their join point, so a five-thousand-point line becomes two
//                objects with no gap where they meet (pen.long_stroke).
//   smoothPath  — the SVG `d` of a stroke: quadratic curves through the midpoints of the
//                simplified points, which is what makes a polyline of recorded points read
//                as a drawn line rather than a joined-up polygon.
//
// Everything is in the units the caller passes in — the Pen tool passes board units and a
// tolerance of one *screen* pixel divided by the zoom; the component passes scaled board
// units. Nothing here knows about Yjs, React or the DOM.

import { STROKE_MAX_POINTS } from '../config.ts';
import type { Point } from '../geometry.ts';

/** The points that can be drawn: finite copies of the input, in its order. */
function usable(points: readonly Point[] | undefined | null): Point[] {
  const out: Point[] = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Two decimals is finer than a screen pixel at any zoom the board can reach. */
function n(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Squared distance from `p` to the segment `a`–`b` — the segment, not its line, so a
 * point beyond an end is measured to that end. Perpendicular distance alone would let a
 * point beside the *middle* of a long segment survive.
 */
function distanceToSegmentSquared(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len = vx * vx + vy * vy;
  if (len === 0) return wx * wx + wy * wy;
  const t = (vx * wx + vy * wy) / len;
  if (t <= 0) return wx * wx + wy * wy;
  if (t >= 1) return (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
  const cross = vx * wy - vy * wx;
  return (cross * cross) / len;
}

/**
 * Ramer–Douglas–Peucker simplification of `points`. The result keeps the first and last
 * point and every input point lies within `tolerance` of the returned polyline.
 *
 * A point is dropped only when no point of the span it was dropped from stands farther
 * than `tolerance` from the segment that replaces that span — which is the guarantee in
 * one sentence, and why a coarser tolerance is a smoother stroke of the same shape rather
 * than a different one. A tolerance that is not a positive number keeps every point.
 *
 * The stack replaces the usual recursion: a stroke is up to `STROKE_MAX_POINTS` points and
 * a deep curve keeps the recursion honest only until it runs out of stack.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const pts = usable(points);
  const out: Point[] = [];
  if (pts.length === 0) return out;
  if (pts.length < 3) return pts;
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const tol2 = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const span = stack.pop()!;
    const a = span[0];
    const b = span[1];
    if (b <= a + 1) continue;
    let far = -1;
    let farIndex = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegmentSquared(pts[i], pts[a], pts[b]);
      if (d > far) {
        far = d;
        farIndex = i;
      }
    }
    if (farIndex < 0 || far <= tol2) continue; // this span is one straight enough run
    keep[farIndex] = 1;
    stack.push([a, farIndex], [farIndex, b]);
  }
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * Cut `points` into strokes of at most `max` points each. Consecutive parts share their
 * join point — the first point of a part is the last point of the one before — so the
 * parts draw as one unbroken line. An empty input yields no parts.
 *
 * The Pen tool calls this only in spirit: it commits a part as soon as it is full and
 * starts the next one at the point it stopped on. This is the same cut as one pure call,
 * which is what makes the join testable without five thousand pointer events.
 */
export function splitPoints(
  points: readonly Point[],
  max: number = STROKE_MAX_POINTS,
): Point[][] {
  const pts = usable(points);
  const parts: Point[][] = [];
  if (pts.length === 0) return parts;
  const size = Number.isFinite(max) && max >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  let start = 0;
  let join: Point | null = null;
  while (start < pts.length) {
    // A part after the first spends one point on the join, so it takes one fewer new one.
    const take = join === null ? size : size - 1;
    const end = Math.min(start + take, pts.length);
    const part: Point[] = join === null ? [] : [join];
    for (let i = start; i < end; i++) part.push(pts[i]);
    parts.push(part);
    join = part[part.length - 1];
    start = end;
  }
  return parts;
}

/**
 * The SVG path data of a stroke drawn through `points`: `M` to the first point, then a
 * quadratic segment per point with each curve ending at the midpoint between it and the
 * next, ending on the last point. The curve therefore never leaves the points it was
 * built from, and never corners at one either: the midpoints are where it passes, the
 * recorded points are where it bends.
 *
 * One point returns a zero-length path, which a round line cap paints as a dot (pen.dot);
 * two points are a straight segment; no points return the empty path.
 */
export function smoothPath(points: readonly Point[]): string {
  const pts = usable(points);
  if (pts.length === 0) return '';
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length === 1) return `M ${n(first.x)} ${n(first.y)} L ${n(first.x)} ${n(first.y)}`;
  let d = `M ${n(first.x)} ${n(first.y)}`;
  if (pts.length === 2) return `${d} L ${n(last.x)} ${n(last.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const next = pts[i + 1];
    d += ` Q ${n(c.x)} ${n(c.y)} ${n((c.x + next.x) / 2)} ${n((c.y + next.y) / 2)}`;
  }
  return `${d} L ${n(last.x)} ${n(last.y)}`;
}
