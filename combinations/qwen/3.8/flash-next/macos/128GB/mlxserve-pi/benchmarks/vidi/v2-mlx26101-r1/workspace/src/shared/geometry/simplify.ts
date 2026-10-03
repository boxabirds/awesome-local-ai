// Turning a path a hand drew into a path worth keeping (story 11).
//
// A pointer's record of a circle is four hundred points, most of which say nothing: they are
// the tremor of a hand and the sampling rate of a mouse, not the shape. `simplify` is
// Ramer-Douglas-Peucker, whose one useful property is that it is a *bound* and not a
// preference — it removes a point only when that point is within `tolerance` of the line
// between the two points that survive around it, so what is left is never farther from what was
// drawn than the number it was handed. That is what lets `pen.smooth` promise "smoothed, but no
// point farther than 1 screen pixel from the path the user drew": the board passes
// STROKE_SIMPLIFY_TOLERANCE_PX divided by the zoom, so the bound is in screen pixels at the
// zoom the person was actually drawing at.
//
// `splitPoints` exists because a stroke is one object holding one array: a path that never
// ends — a person scribbling while the tab streams — would grow without limit and be replaced
// wholesale on every commit. Past the limit the path is cut, and the cut shares its point, so
// the stroke that carries on begins exactly where the one before it ended (pen.long_stroke).
//
// `smoothPath` draws the kept points rather than joining them with straight lines: a quadratic
// that passes through the midpoint of each pair and is steered by the point itself rounds the
// corners without moving the line outside them (a Bézier curve never leaves the convex hull of
// its three points), which is what keeps the *rendered* stroke inside the bound the simplifier
// promised for the *stored* one.
//
// Pure geometry: no Yjs, no DOM, no React. `distanceToSegment` is story 10's, from `./polyline`
// — the same measure an arrow's hit test uses, and the reason "how far is this point from that
// line" is asked one way in this codebase.

import { STROKE_MAX_POINTS } from '../config';
import type { Point } from './geometry';
import { distanceToSegment } from './polyline';

function isFinitePoint(p: Point | undefined | null): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Ramer-Douglas-Peucker: the subset of `points`, first and last included, whose line stays
 * within `tolerance` of every point that was dropped.
 *
 * The stack is explicit rather than recursive on purpose: a stroke is allowed 5,000 points, and
 * a recursive implementation on a path of that size spends 5,000 frames on the way down. A
 * tolerance of 0 (or a nonsense one) keeps every point, which is the honest answer — there is
 * no line that passes exactly through a hand's tremor except the tremor itself.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const pts = points.filter(isFinitePoint);
  if (pts.length <= 2) return pts;
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  if (tol === 0) return pts;

  const last = pts.length - 1;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[last] = 1;

  // Each entry is a span whose ends are already kept; the span's farthest point from that
  // chord either survives (and splits the span) or the span is finished.
  const spans: [number, number][] = [[0, last]];
  while (spans.length > 0) {
    const span = spans.pop()!;
    const from = span[0];
    const to = span[1];
    if (to <= from + 1) continue;
    let index = -1;
    let farthest = 0;
    for (let i = from + 1; i < to; i += 1) {
      const d = distanceToSegment(pts[from]!, pts[to]!, pts[i]!);
      if (d > farthest) {
        farthest = d;
        index = i;
      }
    }
    if (index < 0 || farthest <= tol) continue;
    keep[index] = 1;
    spans.push([from, index], [index, to]);
  }

  const out: Point[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (keep[i]) out.push(pts[i]!);
  }
  return out;
}

/**
 * Cut a path into pieces of at most `max` points, each piece beginning with the point the
 * piece before it ended on.
 *
 * The shared join is the whole point: two strokes that merely touch leave a gap the width of a
 * line cap, and the person who drew one long line is left looking at two short ones. Sharing
 * the point means the second cap is laid over the first, so the seam cannot be seen
 * (pen.long_stroke).
 *
 * A limit of at least 2 is required, because a piece of one point has no line in it: anything
 * else is treated as the setting it was meant to be.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const limit = Number.isFinite(max) && max >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  if (points.length === 0) return [];
  if (points.length <= limit) return [points.slice()];

  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + limit, points.length) - 1;
    parts.push(points.slice(start, end + 1));
    start = end;
  }
  return parts;
}

/**
 * A path string that rounds every corner: `M` to the first point, then a quadratic for each
 * interior point, aimed at that point and finishing at the midpoint of it and the next one, and
 * a straight run onto the last point.
 *
 * Each curve therefore *starts* where the previous one stopped, so there is no join to be seen
 * and no place where a round line join would have to be trusted. The first and last points are
 * hit exactly: a stroke that faded out half a segment short of where the pen lifted would be a
 * stroke in the wrong place.
 *
 * Numbers are written to two decimals. A path is a string, and a float printed in full is
 * forty characters of precision nobody can draw; half a hundredth of a pixel is a rounding no
 * screen can show.
 */
export function smoothPath(points: readonly Point[]): string {
  const pts = points.filter(isFinitePoint);
  if (pts.length === 0) return '';
  const at = (p: Point): string => `${fmt(p.x)} ${fmt(p.y)}`;
  // One point is a zero-length subpath: with a round line cap that is a dot, which is exactly
  // what a press that never moved means (pen.dot).
  if (pts.length === 1) return `M ${at(pts[0]!)} L ${at(pts[0]!)}`;
  if (pts.length === 2) return `M ${at(pts[0]!)} L ${at(pts[1]!)}`;

  let d = `M ${at(pts[0]!)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const here = pts[i]!;
    const next = pts[i + 1]!;
    d += ` Q ${at(here)} ${fmt((here.x + next.x) / 2)} ${fmt((here.y + next.y) / 2)}`;
  }
  return `${d} L ${at(pts[pts.length - 1]!)}`;
}

/** Two decimals, without the trailing zeroes: what a path string is made of. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}
