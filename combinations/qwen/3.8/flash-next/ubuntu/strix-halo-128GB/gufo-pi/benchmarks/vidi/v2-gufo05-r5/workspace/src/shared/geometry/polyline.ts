/**
 * Distance to a polyline (story 10): what a click has to be measured against to select an arrow.
 *
 * An arrow is a line, not a box, so "I clicked it" means "my click came within a few screen pixels
 * of the line". `distanceToPolyline` is that distance in world units; the caller compares it with
 * the tolerance divided by the board zoom, so the target stays the same size on screen at every
 * zoom level.
 */
import type { Point } from '../geometry';

/** The distance from `p` to the closest point of the segment `a`-`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  // A segment with no length is a point: clamping below would divide by zero, and the projection
  // is that point anyway.
  const t = lengthSquared === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = p.x - (a.x + clamped * vx);
  const dy = p.y - (a.y + clamped * vy);
  return Math.hypot(dx, dy);
}

/** The distance from `p` to the nearest point of the path through `points`. */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = distanceToSegment(p, points[i]!, points[i + 1]!);
    if (d < best) best = d;
  }
  return best;
}
