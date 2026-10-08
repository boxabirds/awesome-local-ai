import type { Point } from '../../client/canvas/camera';
import type { Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Return the midpoint of a side on a rect boundary. */
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
 * Return the side of rect `r` whose midpoint is nearest to `toward`.
 * Uses the diagonal criterion: compares the direction vector toward with
 * the two diagonals at each corner to decide which side it points toward.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) {
    // Points more horizontally → left or right
    return dx >= 0 ? 'right' : 'left';
  } else {
    // Points more vertically → top or bottom
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/** Connector endpoints are either attached to an object or fixed to board space. */
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

/** Resolve connector endpoints to actual board coordinates using current object rects. */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromPoint = resolveOne(c.from, rects);
  const toPoint = resolveOne(c.to, rects);
  return { from: fromPoint, to: toPoint };
}

function resolveOne(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') {
    return { x: e.x, y: e.y };
  }
  // Attached: look up target rect
  const r = rects.get(e.objectId);
  if (!r) {
    // Orphaned target – fall back to stored anchor point
    return e.fallback;
  }
  return sideAnchor(r, 'right'); // will be overridden by caller with correct side
}

/** Compute the bounding box covering the arrow line. */
export function connectorBBox(from: Point, to: Point): Rect {
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxX = Math.max(from.x, to.x);
  const maxY = Math.max(from.y, to.y);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
