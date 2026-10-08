/**
 * Polyline distance (shared, story 10): minimum distance from a point to a
 * polyline, used for connector hit-testing. Written for general polylines
 * (story 11's pen strokes reuse it); a two-point polyline is a segment.
 */
import type { Point } from '../geometry';

/** Squared distance from p to segment ab (standard clamped projection). */
function segmentDistanceSquared(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLen2 = abx * abx + aby * aby;
  // Degenerate segment (a === b): plain distance.
  if (abLen2 === 0) {
    return apx * apx + apy * apy;
  }
  // Projection parameter t of p onto ab, clamped to [0, 1].
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
  const cx = a.x + t * abx - p.x;
  const cy = a.y + t * aby - p.y;
  return cx * cx + cy * cy;
}

/**
 * Minimum distance from `p` to the polyline `pts` (consecutive segments).
 * NaN/insufficient input yields Infinity (a miss).
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const d = segmentDistanceSquared(p, a, b);
    if (d < best) {
      best = d;
    }
  }
  return Math.sqrt(best);
}
