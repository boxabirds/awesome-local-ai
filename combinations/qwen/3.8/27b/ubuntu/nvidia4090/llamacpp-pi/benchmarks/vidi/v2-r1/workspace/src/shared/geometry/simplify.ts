// Stroke geometry (story 11, stroke.model contract).
//
//  - simplify: iterative Ramer–Douglas–Peucker. Keeps first and last and
//    guarantees every removed point lies within `tolerance` of the result
//    polyline (pen.smooth: within 1 screen pixel at the drawing zoom).
//  - splitPoints: chunks a long stroke into parts of at most `max` (default
//    STROKE_MAX_POINTS) recorded points, consecutive parts sharing the join
//    point so the committed strokes join with no visible gap (pen.long_stroke).
//  - smoothPath: an SVG path drawing the points with midpoint quadratic
//    segments, round-cap friendly; a single point is a zero-length subpath
//    that renders as a round dot (pen.dot).

import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/** Distance from point `p` to the segment `a`–`b` (clamped projection). */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * Ramer–Douglas–Peucker simplification of `points` at `tolerance` (world
 * units). Iterative (explicit stack: no recursion depth on 5,000 points).
 * Keeps the first and last point; every dropped input point lies within
 * `tolerance` of the returned polyline (pen.smooth faithfulness).
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n === 0) return [];
  if (n <= 2) return points.map((p) => ({ x: p.x, y: p.y }));

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const a = points[s]!;
    const b = points[e]!;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const d = distanceToSegment(a, b, points[i]!);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    // A point farther than the tolerance must be kept; the two sub-segments
    // are simplified independently. At or below it, the whole span collapses
    // to the chord (every interior point is within the tolerance of it).
    if (maxDist > tolerance && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([s, maxIdx], [maxIdx, e]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i] === 1) out.push({ x: points[i]!.x, y: points[i]!.y });
  }
  return out;
}

/**
 * Split `points` into consecutive parts of at most `max` points (default
 * STROKE_MAX_POINTS). Part k+1 starts with part k's last point (shared join
 * point, no visible gap between the committed strokes, pen.long_stroke).
 * Input shorter than `max` yields a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max <= 1) throw new Error('splitPoints: max must be >= 2');
  const n = points.length;
  if (n <= max) return [[...points]];
  const out: Point[][] = [];
  let start = 0;
  while (start < n) {
    const end = Math.min(start + max, n);
    out.push([...points.slice(start, end)]);
    if (end === n) break;
    // Continue with the last point of this part (the shared join point).
    start = end - 1;
  }
  return out;
}

/** Compact, deterministic number formatting (integers stay integers). */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * An SVG path string through `points`: `M p0`, then quadratic midpoint
 * segments (`Q p[i] mid(p[i], p[i+1])`), ending at the last point. The
 * quadratic curves pass through the midpoints of consecutive segments and
 * stay inside their hull, so the rendered path stays within the simplification
 * tolerance of the drawn polyline. A single point yields a zero-length
 * subpath that renders as a round dot with round line caps; the empty list
 * yields ''.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0]!;
  if (n === 1) {
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x)} ${fmt(p0.y)}`;
  }
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i + 1 < n; i += 1) {
    const c = points[i]!;
    const next = points[i + 1]!;
    d += ` Q ${fmt(c.x)} ${fmt(c.y)} ${fmt((c.x + next.x) / 2)} ${fmt((c.y + next.y) / 2)}`;
  }
  const last = points[n - 1]!;
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}
