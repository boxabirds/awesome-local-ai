import type { Point, Rect } from '../geometry';
import type { ConnectorSnap, Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** Midpoint of a side; it lies on the boundary of a rectangle, an ellipse and a diamond alike. */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The side whose wedge (bounded by the rectangle's diagonals) contains the direction from the centre to `toward`. */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Where an end is aimed from the other end: the centre of an attached object, else the point itself. */
function aim(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCenter(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback;
  return sideAnchor(r, nearestSide(r, aim(other, rects)));
}

/** Pure: sides are recomputed from the current rectangles; a missing target is drawn at its stored fallback. */
export function resolveEndpoints(c: Pick<ConnectorSnap, 'from' | 'to'>, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) };
}
