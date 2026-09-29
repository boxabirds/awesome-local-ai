/**
 * Story 10 · polyline maths (design "Files added or changed").
 *
 * A connector is drawn as a polyline (one segment today, a bent path once a
 * waypoint is dragged), so "is this click on the arrow?" is a distance question,
 * not a rectangle question. This file answers it with no DOM, no Yjs and no
 * React, and is deliberately separate from `geometry.ts` so the story-7
 * rectangle rules stay untouched.
 */
import type { Point } from '../geometry';

/** Squared distance, with the degenerate (zero-length) segment handled. */
function distanceToSegmentSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return px * px + py * py;
  }
  // Project `p` onto the line through a→b, clamped to the segment.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const px = p.x - cx;
  const py = p.y - cy;
  return px * px + py * py;
}

/**
 * The distance from `p` to the polyline built from `points`, in the same units
 * as the points. A point that lies *on* the polyline returns 0; a polyline with
 * fewer than two points degenerates to the distance to that lone point (or 0 for
 * none). Never throws on a non-finite input: it returns `Infinity`, so a caller
 * that compares against a tolerance treats it as "not on the line".
 */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (points.length === 0) return Infinity;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return Infinity;
  if (points.length === 1) {
    const only = points[0];
    if (!Number.isFinite(only.x) || !Number.isFinite(only.y)) return Infinity;
    return Math.hypot(p.x - only.x, p.y - only.y);
  }
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const squared = distanceToSegmentSquared(p, a, b);
    if (squared < best) best = squared;
  }
  return Math.sqrt(best);
}
