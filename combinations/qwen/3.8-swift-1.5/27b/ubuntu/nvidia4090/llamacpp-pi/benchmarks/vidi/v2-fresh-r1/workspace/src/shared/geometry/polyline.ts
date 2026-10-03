// Polyline distance helper (shared with story 11).
// Pure functions only — no Yjs, no React.

import type { Point } from '../geometry';

/**
 * Minimum distance from point `p` to the polyline defined by `pts`.
 * The polyline is a sequence of line segments connecting consecutive points.
 * For a single point, returns the distance to that point.
 * For an empty array, returns Infinity.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return distToSegment(p, pts[0], pts[0]);

  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Distance from point `p` to line segment `a`-`b`. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;

  if (lenSq === 0) {
    // a and b are the same point
    return Math.sqrt(apx * apx + apy * apy);
  }

  // Project p onto the line, clamp to [0, 1]
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  const dx = p.x - projX;
  const dy = p.y - projY;
  return Math.sqrt(dx * dx + dy * dy);
}
