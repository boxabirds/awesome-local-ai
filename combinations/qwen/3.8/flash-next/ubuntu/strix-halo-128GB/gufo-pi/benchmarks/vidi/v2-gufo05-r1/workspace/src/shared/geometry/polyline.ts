/**
 * Distance from a point to a polyline (story 10, shared with story 11's pen strokes).
 *
 * A connector is a one-segment polyline and a pen stroke is many, so the same question —
 * "how far is this point from the drawn line?" — serves both the arrow hit test
 * (`connector.select`) and, later, the freehand hit test. It is pure and works in world
 * units, so it can be tested without a document or a DOM.
 */
import type { Point } from '../geometry';

/** The shortest distance from `p` to the segment `a`→`b`. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  // A zero-length segment is a point: the distance is straight to it. Guarding the
  // division also keeps a degenerate point out of a `NaN` that would poison a hit test.
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Project `p` onto the line, clamped to the segment so a point beyond an end measures
  // to that end rather than to the infinite line through it.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The shortest distance from `p` to the polyline through `pts`, in the same units as the
 * points. An empty or single-point polyline measures to that point; fewer than two points
 * is a line that goes nowhere.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pts.length - 1; index += 1) {
    const distance = distanceToSegment(pts[index]!, pts[index + 1]!, p);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}
