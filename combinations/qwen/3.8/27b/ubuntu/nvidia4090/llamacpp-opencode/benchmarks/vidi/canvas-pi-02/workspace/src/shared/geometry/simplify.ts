import type { Point } from '../../client/canvas/camera';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Stroke simplification and path helpers (story 11, stroke.model).
 *
 * - `simplify` is a recursive Ramer-Douglas-Peucker pass: every dropped point
 *   lies within `tolerance` (world units) of the kept polyline, so a finished
 *   stroke stays within the tolerance of what was actually drawn (pen.smooth).
 * - `splitPoints` chunks a very long raw capture into parts of at most
 *   `max` points, sharing the join point so the parts connect (pen.long_stroke).
 * - `smoothPath` builds a deterministic SVG path string: straight line for
 *   <= 2 points, otherwise a quadratic Bezier through the midpoints of
 *   consecutive points (the classic midpoint smoothing).
 */

/** Squared distance from point p to the segment a-b (0 when the segment is degenerate). */
function distToSegmentSq(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  if (abx === 0 && aby === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

/**
 * Ramer-Douglas-Peucker simplification (iterative, no recursion depth limits).
 *
 * `tolerance` is in the same units as the points (callers pass a screen
 * tolerance divided by the zoom, so the visual error is bounded regardless of
 * zoom level). First and last points are always kept.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const tolSq = tolerance * tolerance;

  // Iterative RDP with an explicit stack of [start, end] index pairs.
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistSq = -1;
    let maxIdx = -1;
    const a = points[start]!;
    const b = points[end]!;
    for (let i = start + 1; i < end; i += 1) {
      const d = distToSegmentSq(points[i]!, a, b);
      if (d > maxDistSq) {
        maxDistSq = d;
        maxIdx = i;
      }
    }
    if (maxIdx > 0 && maxDistSq > tolSq) {
      keep[maxIdx] = true;
      // Smaller ranges first keeps the stack shallow for dense captures.
      const leftLen = maxIdx - start;
      const rightLen = end - maxIdx;
      if (leftLen < rightLen) {
        stack.push([start, maxIdx], [maxIdx, end]);
      } else {
        stack.push([maxIdx, end], [start, maxIdx]);
      }
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i]) out.push({ x: points[i]!.x, y: points[i]!.y });
  }
  return out;
}

/**
 * Split a raw point list into parts of at most `max` points (default
 * STROKE_MAX_POINTS). Adjacent parts share the join point (the last point of
 * part i is the first point of part i + 1), so consecutive strokes connect.
 * A list of at most `max` points yields a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length === 0) return [];
  if (points.length <= max) return [[...points]];
  const parts: Point[][] = [];
  for (let start = 0; start < points.length; start += max - 1) {
    const end = Math.min(start + max, points.length);
    parts.push([...points.slice(start, end)]);
    if (end === points.length) break;
  }
  return parts;
}

/** Format a coordinate deterministically (3 decimals, no floating-point noise). */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/**
 * Deterministic SVG path string for a point list.
 *
 * - 0 points: empty string.
 * - 1 point: a zero-length "M x y L x y" (rendered as a round dot with
 *   linecap="round" — pen.dot).
 * - 2 points: a straight line.
 * - 3+ points: M to the first point, then a quadratic Bezier from each
 *   midpoint to the next using the shared point as control (midpoint
 *   smoothing), ending at the last point.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0]!;
  if (n === 1) return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x)} ${fmt(p0.y)}`;
  if (n === 2) return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(points[1]!.x)} ${fmt(points[1]!.y)}`;

  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  // First segment: from p0 to the midpoint of p0-p1, control p0 (straight start).
  let mx = (p0.x + points[1]!.x) / 2;
  let my = (p0.y + points[1]!.y) / 2;
  d += ` Q ${fmt(p0.x)} ${fmt(p0.y)} ${fmt(mx)} ${fmt(my)}`;
  for (let i = 1; i < n - 1; i += 1) {
    const p = points[i]!;
    const nx = (p.x + points[i + 1]!.x) / 2;
    const ny = (p.y + points[i + 1]!.y) / 2;
    d += ` Q ${fmt(p.x)} ${fmt(p.y)} ${fmt(nx)} ${fmt(ny)}`;
  }
  const pl = points[n - 1]!;
  d += ` L ${fmt(pl.x)} ${fmt(pl.y)}`;
  return d;
}
