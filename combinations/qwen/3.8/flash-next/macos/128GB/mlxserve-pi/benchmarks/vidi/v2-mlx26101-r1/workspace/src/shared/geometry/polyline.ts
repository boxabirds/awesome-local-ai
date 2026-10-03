// Distance from a point to a polyline (story 10, shared with story 11's pen tool).
//
// An arrow is a two-point polyline and a freehand stroke will be a many-point one,
// but the hit-test rule is the same for both: how far is this point from the line?
// Pure world-unit arithmetic with no Yjs, DOM or React in it, so the exact boundary
// the PRD cares about ("within 6 screen pixels of the line") is testable with plain
// numbers (connector.select, TC-14).

import type { Point } from './geometry';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Squared distance, so the segment loop never takes a square root per segment. */
function distanceSquared(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/**
 * Shortest distance from `p` to the segment `a`→`b`. The projection parameter is
 * clamped to the segment, so a point beyond either end measures to that end rather
 * than to the infinite line through it. A degenerate segment (a === b) measures to
 * the point.
 */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) {
    return isFiniteNumber(b.x) && isFiniteNumber(b.y)
      ? Math.sqrt(distanceSquared(b, p))
      : Infinity;
  }
  if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y)) {
    return Math.sqrt(distanceSquared(a, p));
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.sqrt(distanceSquared(a, p));
  // t = position of p's projection on the segment, clamped to [0, 1].
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + clamped * dx;
  const cy = a.y + clamped * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Shortest distance from `p` to the polyline through `pts` (the minimum over its
 * segments). Infinity for a list with no finite point, so a point that cannot hit
 * anything never counts as a hit. (connector.select.)
 */
export function distanceToPolyline(
  pts: readonly Point[],
  p: Point,
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) continue;
    if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y)) continue;
    const d = distanceToSegment(a, b, p);
    if (d < best) best = d;
  }
  if (best === Infinity && pts.length === 1) {
    const only = pts[0]!;
    if (isFiniteNumber(only.x) && isFiniteNumber(only.y)) {
      best = Math.hypot(p.x - only.x, p.y - only.y);
    }
  }
  return best;
}
