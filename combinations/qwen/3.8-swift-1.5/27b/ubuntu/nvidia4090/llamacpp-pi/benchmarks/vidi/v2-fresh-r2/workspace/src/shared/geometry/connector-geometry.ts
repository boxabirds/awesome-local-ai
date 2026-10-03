/**
 * Connector endpoint geometry (story 10, connector.model).
 *
 * Attached connector ends store no side: the side is recomputed from the
 * current object rectangles on every render, which is what makes arrows
 * follow moves by anyone and switch sides automatically. No writes are
 * involved — `resolveEndpoints` is pure.
 *
 * All values are world (board) units.
 */

import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of a rect's side (on the boundary for rect, ellipse and diamond). */
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
 * The side of `r` nearest the point `toward`. The direction from the rect's
 * centre is compared against the rect's diagonals: a vector steeper than the
 * diagonal points at a top/bottom side, shallower at a left/right side
 * (the switch happens exactly on the 45° diagonal for a square).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  if (Math.abs(dy) * r.width > Math.abs(dx) * r.height) {
    return dy >= 0 ? 'bottom' : 'top';
  }
  return dx >= 0 ? 'right' : 'left';
}

/**
 * The reference point an endpoint "occupies" for the purpose of choosing the
 * other end's side: a free end is its own point; an attached end is its
 * target's centre, or its stored fallback when the target is missing.
 */
export function endpointReference(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * The drawn point of an endpoint: a free end is its own point; an attached
 * end is the midpoint of its target's side nearest the other end's reference
 * point, or its stored fallback when the target is missing (orphaned).
 */
export function endpointAnchor(e: Endpoint, rects: ReadonlyMap<string, Rect>, otherReference: Point): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback;
  return sideAnchor(r, nearestSide(r, otherReference));
}

/**
 * Resolve both ends of a connector to drawn points from the CURRENT object
 * rectangles. Missing targets resolve to their stored fallback (orphaned
 * render) without throwing. Pure — call on every snapshot.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromReference = endpointReference(c.from, rects);
  const toReference = endpointReference(c.to, rects);
  return {
    from: endpointAnchor(c.from, rects, toReference),
    to: endpointAnchor(c.to, rects, fromReference),
  };
}

/** The (possibly zero-size) rect spanning two points. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}
