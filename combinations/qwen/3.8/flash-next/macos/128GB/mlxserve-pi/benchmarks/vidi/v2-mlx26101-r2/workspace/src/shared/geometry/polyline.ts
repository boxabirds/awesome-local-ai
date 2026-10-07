/**
 * Distance from a point to a polyline (`connector.model`, and story 11's freehand
 * strokes, which is why this is its own module).
 *
 * A straight arrow is a polyline of two points, and "click within 6 screen pixels
 * of the line" (`connector.select`) is a distance from a point to a segment - not
 * a test against the arrow's bounding box, which is the mistake that makes a click
 * in an empty corner select an arrow drawn across it.
 *
 * No Yjs, no React, no DOM, and no throws: a malformed point answers `Infinity`,
 * which is simply "not near".
 */

import type { Point } from '../geometry.js';

/** The distance from `p` to the segment `a`-`b`. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  // A segment of no length is a point; and a point that is not a number is never
  // "near", which is what an Infinity answers.
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Where `p` falls along the segment, clamped to it: before the start or past the
  // end, the nearest point on the segment is that end.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The distance from `p` to the polyline through `pts`, in the same units as the
 * points. Fewer than two points is not a line: the answer is `Infinity`, so a
 * hit test against it never matches.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (!Array.isArray(pts) || pts.length < 2) return Infinity;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return Infinity;
  let best = Infinity;
  for (let index = 0; index + 1 < pts.length; index += 1) {
    const distance = distanceToSegment(pts[index], pts[index + 1], p);
    if (distance < best) best = distance;
  }
  return best;
}
