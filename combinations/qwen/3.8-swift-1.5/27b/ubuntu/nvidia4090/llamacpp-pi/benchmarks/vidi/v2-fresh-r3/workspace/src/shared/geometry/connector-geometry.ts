import type { Rect, Point } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of side `s` of rect `r` (on the boundary). */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top': return { x: r.x + r.width / 2, y: r.y };
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left': return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * The side of rect `r` nearest the point `toward`. Compares the direction
 * from the rect centre to `toward` against the 45° diagonals.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy > 0 ? 'bottom' : 'top';
  }
}

export interface AttachedEndpoint {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

export interface FreeEndpoint {
  kind: 'free';
  x: number;
  y: number;
}

export type Endpoint = AttachedEndpoint | FreeEndpoint;

/**
 * Resolves both endpoints of a connector to concrete world points.
 * Attached ends use `nearestSide` + `sideAnchor` on the target's current
 * rect; missing targets fall back to the stored `fallback` point.
 * Free ends return their stored point directly.
 */
export function resolveEndpoints(
  from: Endpoint,
  to: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  // First, determine a "toward" point for each endpoint.
  // For an attached endpoint, the toward point is the centre of the other
  // endpoint's target rect (or its free point / fallback).
  const fromToward = towardPoint(to, rects);
  const toToward = towardPoint(from, rects);

  const fromPt = resolveOne(from, fromToward, rects);
  const toPt = resolveOne(to, toToward, rects);
  return { from: fromPt, to: toPt };
}

function towardPoint(ep: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') {
    return { x: ep.x, y: ep.y };
  }
  const rect = rects.get(ep.objectId);
  if (rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  return { x: ep.fallback.x, y: ep.fallback.y };
}

function resolveOne(ep: Endpoint, toward: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') {
    return { x: ep.x, y: ep.y };
  }
  const rect = rects.get(ep.objectId);
  if (!rect) {
    // Orphaned: target missing, use fallback
    return { x: ep.fallback.x, y: ep.fallback.y };
  }
  const side = nearestSide(rect, toward);
  return sideAnchor(rect, side);
}

/** The axis-aligned bounding box of the segment from `a` to `b`. */
export function connectorBBox(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
