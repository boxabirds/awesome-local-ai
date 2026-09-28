// Freehand stroke geometry (story 11, pen.smooth / pen.long_stroke):
// Ramer–Douglas–Peucker simplification, long-stroke splitting and SVG
// path generation. Pure: no DOM, no React, no Yjs.

import { STROKE_MAX_POINTS } from '../config';
import type { Point } from '../geometry';

/**
 * Simplifies a polyline with Ramer–Douglas–Peucker at `tolerance`.
 *
 * Iterative (explicit stack, no recursion-depth risk on 5,000-point
 * strokes); keeps the first and last point. Every input point lies within
 * `tolerance` (world units) of the output polyline (pen.smooth). A
 * zero/one-point input is returned unchanged.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  if (!Number.isFinite(tolerance) || tolerance < 0) tolerance = 0;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Stack of [start, end] index pairs to process (iterative RDP).
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let index = -1;
    const a = points[start];
    const b = points[end];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      let dist: number;
      if (lenSq === 0) {
        dist = Math.hypot(p.x - a.x, p.y - a.y);
      } else {
        // Distance from p to the infinite line ab, clamped to the segment.
        let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
        t = Math.max(0, Math.min(1, t));
        dist = Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
      }
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Splits a point list into consecutive parts of at most `max` points
 * (default STROKE_MAX_POINTS). Each part after the first starts with the
 * previous part's LAST point, so the parts join seamlessly when drawn in
 * order (pen.long_stroke). `max` below 2 is clamped to 2.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const m = Math.max(2, Math.floor(max));
  if (points.length <= m) return points.length === 0 ? [] : [points.slice()];
  const parts: Point[][] = [];
  let i = 0;
  while (i < points.length) {
    const end = Math.min(i + m, points.length);
    parts.push(points.slice(i, end));
    if (end === points.length) break;
    // The next part starts at the last point of this one (shared join).
    i = end - 1;
  }
  return parts;
}

/** Formats one path coordinate (2 decimal places, -0 normalised). */
function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r === 0 ? 0 : r);
}

/**
 * Builds a deterministic SVG path `d` string for `points` using quadratic
 * midpoint smoothing (pen.smooth render): `M p0`, then `Q p[i] mid(p[i],
 * p[i+1])` segments ending exactly at the last point.
 *
 * - 0 points: '' (nothing to draw).
 * - 1 point: `M x y` — a zero-length subpath that renders as a round dot
 *   with `stroke-linecap: round` (pen.dot).
 * - 2 points: `M` + `L`.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0];
  if (points.length === 1) return `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)}`;
  if (points.length === 2) {
    const p1 = points[1];
    d += ` L ${fmt(p1.x)} ${fmt(p1.y)}`;
    return d;
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const target =
      i === points.length - 1 ? p : { x: (p.x + points[i + 1].x) / 2, y: (p.y + points[i + 1].y) / 2 };
    d += ` Q ${fmt(p.x)} ${fmt(p.y)} ${fmt(target.x)} ${fmt(target.y)}`;
  }
  return d;
}
