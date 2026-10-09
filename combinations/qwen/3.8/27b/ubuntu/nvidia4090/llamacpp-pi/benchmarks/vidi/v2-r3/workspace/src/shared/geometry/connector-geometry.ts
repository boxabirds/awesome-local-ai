/**
 * Story 10 (connector.model): pure connector geometry.
 *
 * Endpoint resolution: an attached endpoint resolves to the midpoint of the
 * side of its target rect nearest the other end; a free endpoint resolves to
 * its stored point; an attached endpoint whose target is absent resolves to
 * its fallback (no throw). `rects` maps object id → world Rect.
 */
import type { ConnectorSnap, Endpoint } from '../objects/connector';
import { normalizeRect, type Point, type Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of a rect side (on the boundary). */
export function sideAnchor(r: Rect, s: Side): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  switch (s) {
    case 'top':
      return { x: cx, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: cy };
    case 'bottom':
      return { x: cx, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: cy };
  }
}

/**
 * The side of `r` nearest `toward`: the axis with the larger normalised
 * offset (dx/width vs dy/height) decides — the switch happens on the 45°
 * diagonal, and the normalisation makes it aspect-aware for non-square
 * objects. Ties (exactly 45°) go to the horizontal axis.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax * r.height > ay * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * The point a connector end "aims at": the other end's target rect centre,
 * its stored point, or its fallback.
 */
function interest(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return { x: e.fallback.x, y: e.fallback.y };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function resolveOne(e: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return { x: e.fallback.x, y: e.fallback.y };
  return sideAnchor(r, nearestSide(r, other));
}

/**
 * Resolve both endpoints to world points. Each end aims at the other end's
 * centre of interest (its target rect centre, its point, or its fallback).
 */
export function resolveEndpoints(
  c: Pick<ConnectorSnap, 'from' | 'to'>,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const toInterest = interest(c.to, rects);
  const fromInterest = interest(c.from, rects);
  return {
    from: resolveOne(c.from, toInterest, rects),
    to: resolveOne(c.to, fromInterest, rects),
  };
}

/** The bounding box spanning both resolved endpoints (zero size allowed). */
export function connectorBBox(from: Point, to: Point): Rect {
  return normalizeRect(from, to);
}
