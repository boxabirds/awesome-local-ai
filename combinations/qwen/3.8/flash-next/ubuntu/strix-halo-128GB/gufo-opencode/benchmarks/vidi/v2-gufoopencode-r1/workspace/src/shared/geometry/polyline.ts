import type { Point } from '../geometry';

// Story 10: shortest distance from a point to a polyline. Shared with story 11
// (pen hit-testing).

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

export function distanceToPolyline(points: readonly Point[], p: Point): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = distanceToSegment(p, points[i], points[i + 1]);
    if (d < min) min = d;
  }
  return min;
}
