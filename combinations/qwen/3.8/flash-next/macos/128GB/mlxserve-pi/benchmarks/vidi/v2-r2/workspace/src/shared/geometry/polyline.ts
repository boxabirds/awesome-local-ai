// Distance from a point to a polyline. Story 10 needs it for one thing: deciding
// whether a click was *on* an arrow, which is a line a pixel wide and so is not
// something a bounding box can answer - the box around a diagonal arrow is mostly
// empty board.
//
// No Yjs, no React, no camera: pure arithmetic over the board's own units, so the
// precision rule (`connector.select`) is testable in node at the same level as the
// object model.

import type { Point } from '../geometry.js';

/** The distance from `p` to the straight segment `a`-`b`. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSq) || lengthSq === 0) return distance(a, p);
  // Where the point falls along the segment, clamped to its ends: off either end
  // the nearest point on the segment is that end, not the endless line through it.
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance({ x: a.x + t * dx, y: a.y + t * dy }, p);
}

/** The distance from `p` to the polyline through `pts`. */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (!isPoint(p) || pts.length === 0) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return isPoint(pts[0]) ? distance(pts[0], p) : Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!isPoint(a) || !isPoint(b)) continue;
    const d = distanceToSegment(a, b, p);
    if (d < min) min = d;
  }
  return min;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object'
    && value !== null
    && Number.isFinite((value as Point).x)
    && Number.isFinite((value as Point).y)
  );
}
