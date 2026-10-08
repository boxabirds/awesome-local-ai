import type { Rect, Point } from '../geometry';

/** Distance from point p to line segment (a, b). */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point
    const ddx = p.x - a.x;
    const ddy = p.y - a.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // Project p onto the line, clamped to [0,1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const pdx = p.x - projX;
  const pdy = p.y - projY;
  return Math.sqrt(pdx * pdx + pdy * pdy);
}

/** Distance from point p to a polyline defined by an array of points. */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const dist = distanceToSegment(pts[i], pts[i + 1], p);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}
