import type { Point } from '../geometry';

/**
 * Distance from a point to a polyline (story 10). Shared with the future
 * freeform pen strokes (story 11), which hit-test the same way.
 */

/** Squared distance — avoids a square root per segment. */
function distanceToSegmentSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return px * px + py * py;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
}

/**
 * The distance from `p` to the nearest point of the polyline through `pts`.
 * Zero for a single point lying on `p`, and `Infinity` for fewer than one
 * point, which no tolerance comparison can match.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length < 1) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const d = distanceToSegmentSquared(p, pts[i]!, pts[i + 1]!);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
