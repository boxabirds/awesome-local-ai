import type { Point } from '../geometry';

/**
 * Returns the minimum Euclidean distance from point `p` to any segment in the
 * polyline defined by `pts`. If `pts` has fewer than 2 points, returns the
 * distance to the single point (or Infinity if empty).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]);

  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;

  if (lenSq === 0) return dist(p, a);

  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return dist(p, { x: projX, y: projY });
}
