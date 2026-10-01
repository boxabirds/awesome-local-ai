// src/shared/geometry/connector-geometry.ts
// Pure geometry for connector endpoints: side anchors, nearest side, resolution.

import type { Rect, Point } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  z: number;
}

/**
 * Returns the midpoint of the given side of a rect.
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top': return { x: r.x + r.width / 2, y: r.y };
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left': return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * Returns the side of rect `r` that is nearest to point `toward`.
 * Uses the direction vector from the rect's centre to `toward` and compares
 * the x and y components to determine the nearest side.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Compare the absolute direction with the half-extents
  const halfW = r.width / 2;
  const halfH = r.height / 2;

  if (halfW === 0 && halfH === 0) {
    // Degenerate rect: use the larger component
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
  }

  // The side with the smallest "crossing distance" wins.
  // If the direction is more horizontal (|dx|/halfW > |dy|/halfH), it's left/right.
  // Otherwise it's top/bottom.
  if (Math.abs(dx) * halfH > Math.abs(dy) * halfW) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/**
 * Resolves both endpoints of a connector to concrete world points.
 * For attached endpoints, uses `nearestSide` + `sideAnchor` on the target's rect.
 * For free endpoints, uses the stored coordinates.
 * For attached endpoints where the target is missing from `rects`, uses `fallback`.
 */
export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = resolveOne(c.from, c.to, rects);
  const to = resolveOne(c.to, c.from, rects);
  return { from, to };
}

function resolveOne(
  ep: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') {
    return { x: ep.x, y: ep.y };
  }

  // attached
  const targetRect = rects.get(ep.objectId);
  if (!targetRect) {
    // Orphaned: target missing, use fallback
    return { x: ep.fallback.x, y: ep.fallback.y };
  }

  // Determine the direction toward the other endpoint
  const otherPoint = resolveOne(other, ep, rects);
  const side = nearestSide(targetRect, otherPoint);
  return sideAnchor(targetRect, side);
}

/**
 * Returns the bounding box of a connector (from the two resolved endpoints).
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
