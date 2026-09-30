import type { Point } from '@shared/geometry';

/**
 * Compute the minimum distance from point `p` to a polyline defined by `pts`.
 * The polyline is the sequence of line segments between consecutive points.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return distanceBetweenPoints(pts[0], p);

  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i], pts[i + 1], p);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Distance from point p to the line segment from a to b.
 */
function distanceToSegment(a: Point, b: Point, p: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return distanceBetweenPoints(a, p);

  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const closest: Point = { x: a.x + t * abx, y: a.y + t * aby };
  return distanceBetweenPoints(closest, p);
}

export function distanceBetweenPoints(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}
