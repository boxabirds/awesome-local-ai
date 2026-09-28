import type { Rect, Point } from './index';

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
 * Determine the nearest side of rect `r` to the point `toward`.
 * Uses angle comparison against the rect's diagonals.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Handle degenerate case where toward is the center
  if (dx === 0 && dy === 0) return 'right';

  // Use the aspect ratio to determine diagonal angles
  // The diagonals of the rect have slope = height/width and -height/width
  // For a point at angle theta from center:
  //   right side: -atan2(h/2, w/2) < theta < atan2(h/2, w/2)  (within horizontal diagonal band)
  //   top side: atan2(h/2, w/2) < theta < pi - atan2(h/2, w/2)
  // etc.

  const halfW = r.width / 2;
  const halfH = r.height / 2;

  // The comparison: if |dx|/halfW >= |dy|/halfH, the point is in the horizontal wedge
  // Use cross-multiplication to avoid division
  if (Math.abs(dx) * halfH >= Math.abs(dy) * halfW) {
    // Horizontal wedge
    return dx >= 0 ? 'right' : 'left';
  } else {
    // Vertical wedge
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/** Endpoint type used for connectors */
export interface EndpointAttached {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

export interface EndpointFree {
  kind: 'free';
  x: number;
  y: number;
}

export type Endpoint = EndpointAttached | EndpointFree;

/**
 * Resolve the world-space start and end points of a connector from its endpoints
 * and the current rects of objects on the board.
 */
export function resolveEndpoints(
  from: Endpoint,
  to: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromPt = resolveEndpoint(from, to, rects);
  const toPt = resolveEndpoint(to, from, rects);
  return { from: fromPt, to: toPt };
}

function resolveEndpoint(
  endpoint: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  // attached
  const rect = rects.get(endpoint.objectId);
  if (!rect) {
    // Orphaned: use fallback
    return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  }
  // Find the other end's resolved point to determine which side to anchor
  const otherPt = other.kind === 'free'
    ? { x: other.x, y: other.y }
    : (() => {
        const otherRect = rects.get(other.objectId);
        return otherRect
          ? { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 }
          : { x: other.fallback.x, y: other.fallback.y };
      })();

  const side = nearestSide(rect, otherPt);
  return sideAnchor(rect, side);
}

/**
 * Compute the bounding box of a line segment.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
