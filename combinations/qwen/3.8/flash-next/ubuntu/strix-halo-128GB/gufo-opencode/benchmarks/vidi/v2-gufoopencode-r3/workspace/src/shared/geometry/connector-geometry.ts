import type { ConnectorSnap, Endpoint } from '../objects/connector';
import type { Point, Rect } from '../geometry';

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

// The side whose midpoint is closest to `toward`; ties fall to the horizontal
// sides, so the switch happens exactly at the 45 degree diagonal.
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

// A first-guess position for an end, used as the "toward" when resolving the
// other end (centres are good enough to pick sides; the exact anchor of the
// other end is used for refinement).
function approxPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (r === undefined) return { x: e.fallback.x, y: e.fallback.y };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// Missing target objects are not an error: their end renders at the stored
// fallback point (orphaned state, design "Connector endpoint").
function endpointPoint(
  e: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  toward: Point
): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (r === undefined) return { x: e.fallback.x, y: e.fallback.y };
  return sideAnchor(r, nearestSide(r, toward));
}

export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>
): { from: Point; to: Point } {
  const fromApprox = approxPoint(c.from, rects);
  const to = endpointPoint(c.to, rects, fromApprox);
  const from = endpointPoint(c.from, rects, to);
  return { from, to };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  };
}
