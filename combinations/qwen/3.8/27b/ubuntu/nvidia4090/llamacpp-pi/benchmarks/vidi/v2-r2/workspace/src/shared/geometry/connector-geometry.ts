/**
 * Connector endpoint geometry (story 10, design connector.object): side
 * anchors, nearest-side selection and endpoint resolution against live
 * object rects.
 *
 * All values are in world units; nothing here knows about the camera, the
 * DOM or Yjs. Endpoint descriptors come from the connector model
 * (shared/objects/connector) — imported type-only to avoid a runtime cycle.
 */
import { CONNECTOR_ARROWHEAD_SIZE_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { endpointRef, type Endpoint } from '../objects/endpoint';

/** The four sides of an object's bounding box. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The anchor point on `rect`'s `side`: the midpoint of that edge.
 */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

/**
 * The side of `rect` nearest to `toward` (the point the other endpoint
 * aims at).
 *
 * The decision compares the direction from the rect centre against the
 * rect's aspect: with |dx|*h >= |dy|*w the horizontal side wins, which
 * for a square switches exactly at the 45-degree diagonals (44 degrees
 * still selects the horizontal side, 46 degrees the vertical one).
 *
 * A non-finite `toward` falls back to 'right' (defensive; callers resolve
 * references before invoking).
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return 'right';
  }
  const adx = Math.abs(dx) * rect.height;
  const ady = Math.abs(dy) * rect.width;
  if (adx >= ady) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Resolves a connector's endpoint descriptors to concrete points.
 *
 * - `free` endpoints resolve to their stored point.
 * - `attached` endpoints resolve to the side anchor of the target's *live*
 *   rect, on the side nearest the other endpoint's reference point (the
 *   other endpoint's resolved point, or its target's centre / fallback).
 * - A missing target rect (the object was deleted) resolves to the stored
 *   `fallback` — the last known anchor — and never throws.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { fromPoint: Point; toPoint: Point } {
  const resolve = (end: Endpoint, otherRef: Point): Point => {
    if (end.kind === 'free') {
      return { x: end.x, y: end.y };
    }
    const rect = rects.get(end.objectId);
    if (rect === undefined) {
      return { x: end.fallback.x, y: end.fallback.y };
    }
    return sideAnchor(rect, nearestSide(rect, otherRef));
  };

  const fromPoint = resolve(c.from, endpointRef(c.to, rects));
  const toPoint = resolve(c.to, endpointRef(c.from, rects));
  return { fromPoint, toPoint };
}

/**
 * The bounding box spanning the two resolved endpoints (zero size for a
 * perfectly straight line is valid).
 */
export function connectorBBox(fromPoint: Point, toPoint: Point): Rect {
  const minX = Math.min(fromPoint.x, toPoint.x);
  const minY = Math.min(fromPoint.y, toPoint.y);
  return {
    x: minX,
    y: minY,
    width: Math.abs(toPoint.x - fromPoint.x),
    height: Math.abs(toPoint.y - fromPoint.y),
  };
}

/**
 * The arrowhead triangle at `toPoint`, pointing from `fromPoint` towards
 * it: the tip sits at `toPoint`, the base is `size` behind the tip and
 * `size` wide (half-width `size/2` perpendicular to the line). A
 * degenerate (zero-length) line points along +x (defensive; the model
 * rejects zero-length connectors).
 */
export function arrowheadPoints(
  fromPoint: Point,
  toPoint: Point,
  size: number = CONNECTOR_ARROWHEAD_SIZE_WORLD,
): { tip: Point; baseLeft: Point; baseRight: Point } {
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;
  // Perpendicular (90-degree rotation of the unit direction).
  const px = -uy;
  const py = ux;
  const tip = { x: toPoint.x, y: toPoint.y };
  const baseCenter = { x: toPoint.x - ux * size, y: toPoint.y - uy * size };
  return {
    tip,
    baseLeft: { x: baseCenter.x + px * (size / 2), y: baseCenter.y + py * (size / 2) },
    baseRight: { x: baseCenter.x - px * (size / 2), y: baseCenter.y - py * (size / 2) },
  };
}
