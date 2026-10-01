import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The part of a connector the geometry needs. */
export interface ConnectorEnds { from: Endpoint; to: Endpoint }

const HALF = 2;

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** Midpoint of a side; it lies on the outline of a rectangle, an ellipse and a diamond alike. */
export function sideAnchor(r: Rect, s: Side): Point {
  const c = rectCentre(r);
  switch (s) {
    case 'top': return { x: c.x, y: r.y };
    case 'bottom': return { x: c.x, y: r.y + r.height };
    case 'left': return { x: r.x, y: c.y };
    default: return { x: r.x + r.width, y: c.y };
  }
}

/** The side whose cone (bounded by the rectangle's diagonals) contains `toward`; ties go to left/right. */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy < 0 ? 'top' : 'bottom';
}

/** The point an end looks toward when its neighbour picks a side: the object's centre, or the free point. */
export function endReference(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCentre(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback; // target deleted concurrently: drawn where it was attached
  return sideAnchor(r, nearestSide(r, endReference(other, rects)));
}

/** Both line ends from the current object rectangles; attached ends pick their side every call. */
export function resolveEndpoints(c: ConnectorEnds, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y),
  };
}
