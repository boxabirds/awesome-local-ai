// Connector geometry (story 10, connector-geometry contract): which side of a
// rect an arrow attaches to, and where the arrow's ends actually sit.

import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of one side of `r`. */
export function sideAnchor(r: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * The side of `r` nearest to `p`, measured by the distance to the rect's
 * centre scaled by the opposite dimension: a point directly above (even far
 * off-centre) is on the top side, a point far off-centre but slightly above
 * is on the left/right side. Ties go to the horizontal side.
 */
export function nearestSide(r: Rect, p: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = Math.abs(p.x - cx);
  const dy = Math.abs(p.y - cy);
  const horizontalScore = dx * r.height;
  const verticalScore = dy * r.width;
  if (horizontalScore === 0 && verticalScore === 0) return 'top';
  if (horizontalScore >= verticalScore) return p.x >= cx ? 'right' : 'left';
  return p.y >= cy ? 'bottom' : 'top';
}

/**
 * Resolve both endpoints of a connector into world points:
 *  - a free endpoint is its stored point;
 *  - an attached endpoint is the midpoint of the target's CURRENT bounds on
 *    the side nearest to the OTHER endpoint (the connector's own position,
 *    not the click point), or the stored fallback when the target is gone
 *    (deleted or unknown), so a stale reference never crashes the board.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const otherPos = (ep: Endpoint): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const r = rects.get(ep.objectId);
    if (r === undefined) return { x: ep.fallback.x, y: ep.fallback.y };
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const resolve = (e: Endpoint, other: Endpoint): Point => {
    if (e.kind === 'free') return { x: e.x, y: e.y };
    const r = rects.get(e.objectId);
    if (r === undefined) return { x: e.fallback.x, y: e.fallback.y };
    return sideAnchor(r, nearestSide(r, otherPos(other)));
  };
  return { from: resolve(c.from, c.to), to: resolve(c.to, c.from) };
}

/** The bounding box of a two-point connector (0x0 when both ends coincide). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
