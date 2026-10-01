import type { Rect, Point } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Returns the midpoint of the given side of the rect.
 */
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
 * Returns the side of rect `r` that is nearest to point `toward`.
 * The side is determined by comparing the direction vector from the rect
 * centre to `toward` against the rect's diagonal boundaries.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  const hw = r.width / 2;
  const hh = r.height / 2;

  // Use the ratio test: if adx * hh > ady * hw, horizontal wins
  if (adx * hh > ady * hw) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

export interface ConnectorAttachedEndpoint {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

export interface ConnectorFreeEndpoint {
  kind: 'free';
  x: number;
  y: number;
}

export type ConnectorEndpointSnap = ConnectorAttachedEndpoint | ConnectorFreeEndpoint;

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  from: ConnectorEndpointSnap;
  to: ConnectorEndpointSnap;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

/**
 * Resolves the from/to endpoints of a connector to concrete world points
 * using the current rects of all objects.
 */
export function resolveEndpoints(
  c: { from: ConnectorEndpointSnap; to: ConnectorEndpointSnap },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = resolveOne(c.from, c.to, rects);
  const to = resolveOne(c.to, c.from, rects);
  return { from, to };
}

function resolveOne(
  ep: ConnectorEndpointSnap,
  other: ConnectorEndpointSnap,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') {
    return { x: ep.x, y: ep.y };
  }

  // Attached: find the target rect
  const targetRect = rects.get(ep.objectId);
  if (!targetRect) {
    // Orphaned: use fallback
    return { x: ep.fallback.x, y: ep.fallback.y };
  }

  // Find the other end's centre to determine direction
  let otherPoint: Point;
  if (other.kind === 'free') {
    otherPoint = { x: other.x, y: other.y };
  } else {
    const otherRect = rects.get(other.objectId);
    if (!otherRect) {
      otherPoint = other.fallback;
    } else {
      otherPoint = { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
    }
  }

  const side = nearestSide(targetRect, otherPoint);
  return sideAnchor(targetRect, side);
}

/**
 * Returns the bounding box of a line from `from` to `to`.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
}
