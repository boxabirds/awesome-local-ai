// Distance from a point to a polyline (story 10, contract `connector.select`).
//
// The arrow's hit test is "how far is this click from the line", so the
// distance has to be exact for a two-point line and for any longer chain
// (story 11 reuses this for the pen). Everything here is plain number math:
// no DOM, no canvas, no rounding — a point exactly ON the line measures 0.

import type { Point } from '../geometry';

/** Squared distance between two points (avoids a sqrt per segment). */
function distanceSq(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/**
 * Distance from `p` to the segment `a`→`b`.
 *
 * The perpendicular is only a candidate when it lands between the endpoints
 * (t in [0,1]); otherwise the nearest point is one of the ends, which is what
 * keeps a "distance to a line" honest at the corners.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSq = vx * vx + vy * vy;
  if (lengthSq === 0) return Math.sqrt(distanceSq(p, a));
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSq;
  if (t <= 0) return Math.sqrt(distanceSq(p, a));
  if (t >= 1) return Math.sqrt(distanceSq(p, b));
  const cx = a.x + t * vx;
  const cy = a.y + t * vy;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distance from `p` to the polyline through `pts`, in the same units as the
 * points. Fewer than two points is not a line, so the distance is infinite —
 * a degenerate arrow can never be "hit". A non-finite query point also
 * measures infinity rather than NaN.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return Number.POSITIVE_INFINITY;
  if (!pts || pts.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const d = distanceToSegment(p, a, b);
    if (d < best) best = d;
  }
  return best;
}
