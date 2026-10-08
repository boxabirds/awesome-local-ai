import type { Point } from '../geometry';

/**
 * Distance from a point to a polyline (story 10, `connector.select`).
 *
 * A connector's arrow is a polyline of its resolved endpoints — two points for a
 * straight arrow, more once curved connectors exist — and clicking it should work
 * from anywhere near the line, not only exactly on it. The caller compares the
 * result with `CONNECTOR_HIT_TOLERANCE_PX / zoom`, so the tolerance stays the same
 * number of *screen* pixels whatever the zoom (PRD connector.select).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distanceToSegment(pts[i], pts[i + 1], p);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Distance from `p` to the segment `a`-`b`: the projection is clamped to the
 * segment, so past either end the distance is to that end (tested in TC-14).
 */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  // A degenerate segment (both ends on top of each other) is a point.
  const t = lenSq === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = a.x + clamped * vx;
  const py = a.y + clamped * vy;
  return Math.hypot(p.x - px, p.y - py);
}
