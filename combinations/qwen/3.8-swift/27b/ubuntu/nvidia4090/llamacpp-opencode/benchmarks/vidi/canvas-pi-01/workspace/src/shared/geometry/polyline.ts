// Point-to-polyline distance (shared by the connector hit test, story 10,
// and story 11's freehand strokes). Pure maths, no DOM, no Yjs.

import type { Point } from '../geometry';

/** Distance from a point to a line segment. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(apx - t * abx, apy - t * aby);
}

/**
 * Minimum distance from `p` to the polyline `pts` (world units). Infinity
 * for an empty polyline.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    best = Math.min(best, distanceToSegment(p, a, b));
  }
  return best;
}
