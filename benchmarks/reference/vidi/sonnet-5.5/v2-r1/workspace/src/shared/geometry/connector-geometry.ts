import type { Endpoint } from '../objects/connector';
import type { ConnectorSnap } from '../objects/connector';
import type { Point, Rect } from './index';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

const HALF = 2;

/** Midpoint of one side (also on the outline of an ellipse or diamond filling the rect). */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / HALF, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / HALF, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / HALF };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / HALF };
  }
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** The side whose wedge (bounded by the rect's diagonals) contains the direction from the centre to `toward`. */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const w = r.width > 0 ? r.width : 1;
  const h = r.height > 0 ? r.height : 1;
  // Scale by the rect's size so the wedges follow the diagonals of non-square rects.
  if (Math.abs(dx) / w >= Math.abs(dy) / h) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The point an endpoint is aimed at when the other end looks for its side. */
function reference(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCentre(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback;
  return sideAnchor(r, nearestSide(r, reference(other, rects)));
}

/** Current end points: each attached end sits on the side of its object nearest the other end; a missing target uses its fallback. */
export function resolveEndpoints(c: Pick<ConnectorSnap, 'from' | 'to'>, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}
