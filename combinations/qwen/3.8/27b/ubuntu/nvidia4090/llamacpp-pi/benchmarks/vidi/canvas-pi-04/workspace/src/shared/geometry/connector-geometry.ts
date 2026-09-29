// Story 10: arrow geometry (anchor: connector.geometry).
//
// An attached endpoint is a (objectId, side) pair, and the side is chosen by
// `nearestSide`: the rectangle side whose outward normal is closest to the
// direction towards the other endpoint's centre. Side anchors are the
// midpoints of the rectangle sides, so arrows meet objects cleanly on all
// four sides.
//
// This module is pure geometry over world-unit rects; the model
// (objects/connector.ts) owns the document writes.

import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of a rectangle side. */
export function sideAnchor(r: Rect, side: Side): Point {
  switch (side) {
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
 * The side of `r` nearest to an external point `toward`.
 *
 * The switch happens exactly on the rectangle diagonal: projecting
 * (toward − centre) onto the half-extents, the horizontal side (right/left)
 * wins when |dx|/halfWidth > |dy|/halfHeight, the vertical side (top/bottom)
 * otherwise.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  const halfW = r.width / 2;
  const halfH = r.height / 2;
  if (Math.abs(dx) * halfH > Math.abs(dy) * halfW) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

function refPoint(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const r = rects.get(end.objectId);
  if (r === undefined) return { x: end.fallback.x, y: end.fallback.y };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function anchorAt(end: Endpoint, otherRef: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const r = rects.get(end.objectId);
  if (r === undefined) return { x: end.fallback.x, y: end.fallback.y };
  return sideAnchor(r, nearestSide(r, otherRef));
}

/**
 * The concrete world points of a connector's endpoints, following their
 * current objects (connector.endpoints):
 * - attached to an existing object: the side anchor on the side nearest the
 *   other endpoint's centre (or the object's own point when free);
 * - attached to a missing object (deleted concurrently): the stored
 *   `fallback` — the anchor at attach time;
 * - free: the stored point.
 */
export function resolveEndpoints(
  connector: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromRef = refPoint(connector.to, rects);
  const toRef = refPoint(connector.from, rects);
  return {
    from: anchorAt(connector.from, fromRef, rects),
    to: anchorAt(connector.to, toRef, rects),
  };
}

/** The bounding rect of a resolved connector (for hit-testing and selection boxes). */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) };
}
