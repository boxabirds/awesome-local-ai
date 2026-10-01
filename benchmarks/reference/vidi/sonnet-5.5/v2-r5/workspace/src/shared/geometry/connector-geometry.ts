import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from './index';

const HALF = 2;

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector'; from: Endpoint; to: Endpoint;
}

export const centreOf = (r: Rect): Point => ({ x: r.x + r.width / HALF, y: r.y + r.height / HALF });

export function sideAnchor(r: Rect, s: Side): Point {
  const c = centreOf(r);
  switch (s) {
    case 'top': return { x: c.x, y: r.y };
    case 'bottom': return { x: c.x, y: r.y + r.height };
    case 'left': return { x: r.x, y: c.y };
    case 'right': return { x: r.x + r.width, y: c.y };
  }
}

/** The side whose wedge (bounded by the rectangle's diagonals) contains `toward`; ties go to left/right. */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = centreOf(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Where an endpoint is aimed at when the other end looks for its nearest side. */
function aimPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? centreOf(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback; // target vanished concurrently: draw at the stored anchor
  return sideAnchor(r, nearestSide(r, aimPoint(other, rects)));
}

/** Recomputed from the current rectangles on every call, so moves by anyone redraw the arrow. */
export function resolveEndpoints(
  c: Pick<ConnectorSnap, 'from' | 'to'>, rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y),
  };
}
