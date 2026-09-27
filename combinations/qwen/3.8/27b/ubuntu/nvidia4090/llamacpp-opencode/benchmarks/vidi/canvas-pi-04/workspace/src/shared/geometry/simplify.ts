// Story 11: stroke smoothing and path helpers (anchor: stroke.model).
//
// Pure, framework-free geometry shared by the Pen tool (commit) and the
// StrokeObject (render + hit test). All functions are deterministic and
// return new values; `simplify` guarantees the smoothing-faithfulness bound
// (pen.smooth): every input point lies within `tolerance` of the output
// polyline.

import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/**
 * Ramer-Douglas-Peucker simplification. Keeps the first and last points and
 * guarantees every input point lies within `tolerance` (the same units as the
 * input) of the returned polyline. Iterative (explicit stack) so a 5,000-point
 * stroke never overflows the call stack.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const t = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;

  // keep[i] is true when point i survives; the ends always do.
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Each stack entry is a (start, end) index pair whose interior still needs
  // simplifying against the chord start->end.
  const start: number[] = [0];
  const end: number[] = [n - 1];
  while (start.length > 0) {
    const s = start.pop()!;
    const e = end.pop()!;
    const a = points[s];
    const b = points[e];
    let maxDist = -1;
    let index = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicularDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > t && index !== -1) {
      keep[index] = 1;
      start.push(s, index);
      end.push(index, e);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i] !== 0) out.push(points[i]);
  }
  return out;
}

/**
 * Split a long point list into consecutive parts of at most `max` points
 * (default {@link STROKE_MAX_POINTS}). Consecutive parts share their join
 * point: part k+1's first point is part k's last point, so the strokes join
 * seamlessly (pen.long_stroke). A list of `max` or fewer points is one part.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const limit = Number.isFinite(max) && max >= 2 ? max : STROKE_MAX_POINTS;
  if (points.length <= limit) return [points.slice()];
  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    const e = Math.min(start + limit, points.length);
    parts.push(points.slice(start, e));
    if (e >= points.length) break;
    start = e - 1; // the next part reuses the join point
  }
  return parts;
}

/**
 * An SVG path `d` for `points` using quadratic midpoint smoothing (pen.draw):
 * `M p0`, then one `Q p[i] mid(p[i], p[i+1])` per interior point, ending with
 * a line to the last point. A single point is a zero-length segment so the
 * round linecap renders it as a dot. Deterministic (fixed number formatting).
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) {
    const p = points[0];
    return `M ${fmt(p.x)} ${fmt(p.y)} L ${fmt(p.x)} ${fmt(p.y)}`;
  }
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    d += ` Q ${fmt(p.x)} ${fmt(p.y)} ${fmt((p.x + q.x) / 2)} ${fmt((p.y + q.y) / 2)}`;
  }
  const last = points[n - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

/**
 * Perpendicular distance from `p` to the infinite line through `a` and `b`
 * (the RDP distance). Degenerate (a === b) is the point distance.
 */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Format a coordinate deterministically (3 decimals, no negative zero). */
function fmt(value: number): string {
  let r = Math.round(value * 1000) / 1000;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}
