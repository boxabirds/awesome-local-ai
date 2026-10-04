/**
 * Pure connector (arrow) geometry (story 10): side anchors, nearest-side
 * selection, endpoint resolution and bounding boxes. No DOM, no React, no Yjs.
 */
import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface ConnectorEnds {
  from: Endpoint;
  to: Endpoint;
}

/**
 * The midpoint of one side of a rect (on the boundary for rect, ellipse and
 * diamond alike).
 */
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

/**
 * The side of `r` whose midpoint is nearest to `toward`. Compares the
 * direction vector with the rect's diagonals, so the switch happens on the
 * 45° diagonals.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/** The centre of a rect. */
export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Resolve a connector's endpoints to concrete points from the current object
 * rects. Attached ends resolve to the midpoint of the target's side nearest
 * the other end; a missing target resolves to the stored fallback point
 * (orphaned condition). No writes — calling this on every snapshot is what
 * makes arrows follow remote moves.
 */
export function resolveEndpoints(c: ConnectorEnds, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point } {
  const towards = (other: Endpoint): Point => {
    if (other.kind === 'free') return { x: other.x, y: other.y };
    const r = rects.get(other.objectId);
    return r ? rectCentre(r) : { ...other.fallback };
  };
  const resolve = (e: Endpoint, other: Endpoint): Point => {
    if (e.kind === 'free') return { x: e.x, y: e.y };
    const r = rects.get(e.objectId);
    if (!r) return { ...e.fallback };
    return sideAnchor(r, nearestSide(r, towards(other)));
  };
  return { from: resolve(c.from, c.to), to: resolve(c.to, c.from) };
}

/** The (possibly degenerate) bounding rect of a two-point line. */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}
