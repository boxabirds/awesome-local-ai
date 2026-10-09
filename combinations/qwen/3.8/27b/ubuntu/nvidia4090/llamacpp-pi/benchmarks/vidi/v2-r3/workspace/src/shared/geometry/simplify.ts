/**
 * Story 11 (stroke.model): polyline simplification, splitting and smoothed
 * path rendering for freehand pen strokes.
 *
 * Simplification is a local, client-side operation — the simplified points
 * are what get written to the shared document (and what a remote peer
 * re-renders directly).
 */
import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';
import { distanceToSegment } from './polyline';

/**
 * Ramer–Douglas–Peucker simplification (iterative with an explicit stack, so
 * a 5,000-point stroke cannot blow the call stack). Keeps the first and last
 * points; every dropped point lies within `tolerance` (world units) of the
 * returned polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = points[a];
    const pb = points[b];
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(pa, pb, points[i]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Split a recorded point list into consecutive parts of at most `max`
 * points; each part after the first starts with the previous part's last
 * point (the join), so the pen appears to keep drawing. A list of `max` or
 * fewer points is a single part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (max < 2) throw new Error('max must be at least 2');
  if (points.length <= max) return [points.slice()];
  const step = max - 1;
  const parts: Point[][] = [];
  for (let i = 0; i < points.length; i += step) {
    parts.push(points.slice(i, i + max));
    if (i + max >= points.length) break;
  }
  return parts;
}

/** Format a coordinate for a path string (2 decimals keeps paths compact). */
function f(v: number): number {
  return Number(v.toFixed(2));
}

/**
 * An SVG path `d` string for the given world-space points: a quadratic
 * Béziers-through-midpoints smoothing (the curve passes through every
 * point's midpoint, so the drawn line tracks the hand closely). A single
 * point yields a zero-length path (rendered as a round dot by the round
 * line cap); two points a straight segment.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p = points.map((q) => ({ x: f(q.x), y: f(q.y) }));
  if (n === 1) return `M ${p[0].x} ${p[0].y} L ${p[0].x} ${p[0].y}`;
  if (n === 2) return `M ${p[0].x} ${p[0].y} L ${p[1].x} ${p[1].y}`;
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i + 1 < n; i++) {
    const mx = f((p[i].x + p[i + 1].x) / 2);
    const my = f((p[i].y + p[i + 1].y) / 2);
    d += ` Q ${p[i].x} ${p[i].y} ${mx} ${my}`;
  }
  d += ` L ${p[n - 1].x} ${p[n - 1].y}`;
  return d;
}
