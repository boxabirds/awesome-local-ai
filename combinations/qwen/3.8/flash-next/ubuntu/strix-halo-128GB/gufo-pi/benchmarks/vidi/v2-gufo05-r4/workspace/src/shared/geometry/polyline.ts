/**
 * Distance from a point to a polyline — the maths behind "did you click the arrow?".
 *
 * An arrow is a line one or two pixels wide, and nobody aims a pointer at two pixels. So the
 * question a click asks is not "is this point on the line" but "how far from the line is it",
 * answered in board units and compared against a tolerance given in screen pixels. The answer
 * has to be the distance to the *segments*, not to the infinite line through them: an arrow
 * that stops short does not extend forever, and a click in line with its tail is a click on
 * nothing.
 *
 * Pure, shared and DOM-free, because both the click that selects an arrow and the drag that
 * drops one on an object need the same answer.
 */

import type { Point } from '../geometry';

function usable(point: Point | undefined): point is Point {
  return (
    !!point &&
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

/** How far `p` is from the segment `a`-`b`, measured to the segment rather than its line. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  // A segment of no length is a dot, and dividing by it would be a NaN wearing a number.
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // How far along the segment the perpendicular foot falls, clamped to the segment itself:
  // outside it the nearest point is the endpoint, which is what "before the start" means.
  const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const t = along < 0 ? 0 : along > 1 ? 1 : along;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The distance from `p` to the polyline through `points`, in the same units as the points.
 *
 * One point is a dot, so the answer is the distance to it. No points at all is nowhere, and
 * the honest answer for that is infinity: nothing is that far from a line that does not exist,
 * which also makes it safe as the starting value of a minimum.
 */
export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (!Array.isArray(points) || points.length === 0 || !usable(p)) return Number.POSITIVE_INFINITY;
  const first = points[0];
  if (!usable(first)) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(p.x - first.x, p.y - first.y);

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!usable(a) || !usable(b)) continue;
    const distance = distanceToSegment(a, b, p);
    if (distance < best) best = distance;
  }
  return best;
}
