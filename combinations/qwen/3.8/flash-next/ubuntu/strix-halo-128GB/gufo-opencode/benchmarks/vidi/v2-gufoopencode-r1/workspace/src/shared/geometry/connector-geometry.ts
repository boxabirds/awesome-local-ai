import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

// Story 10: arrow anchoring geometry. Side anchors sit on the boundary of
// rect, ellipse and diamond alike (the midpoints of the bounding box), so a
// single function serves every anchorable kind.

export type Side = 'top' | 'right' | 'bottom' | 'left';

export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
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

// The rect's diagonals split the plane around its centre into four regions.
// A direction shallower than the diagonal lands left/right; a steeper one lands
// top/bottom.
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function centreOf(ep: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (rect === undefined) return ep.fallback;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function anchorOne(ep: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (rect === undefined) return ep.fallback;
  return sideAnchor(rect, nearestSide(rect, other));
}

// Recompute both anchors from the current rects each call; the other end is
// approximated by its centre or free point so there is no circular dependency.
// A missing target falls back to its stored point without throwing.
export function resolveEndpoints(
  conn: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>
): { from: Point; to: Point } {
  return {
    from: anchorOne(conn.from, centreOf(conn.to, rects), rects),
    to: anchorOne(conn.to, centreOf(conn.from, rects), rects)
  };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y)
  };
}
