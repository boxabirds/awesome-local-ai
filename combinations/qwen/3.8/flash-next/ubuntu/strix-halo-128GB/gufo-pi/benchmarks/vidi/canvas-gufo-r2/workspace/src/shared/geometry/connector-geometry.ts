/**
 * Connector geometry (story 10).
 *
 * Pure maths for side anchors, nearest side, endpoint resolution and bounding boxes.
 * All coordinates are world units.
 */
import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of the given side of a rect. */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

/**
 * Determine which side of rect `r` is nearest to the point `toward`.
 * Uses the angle from the centre of `r` to `toward` compared against the diagonals.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Compare |dy/dx| against height/width to determine which side.
  // If the angle is more horizontal than the diagonal → left or right.
  // If more vertical → top or bottom.
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Diagonal ratio: height / width
  // tan(angle) = dy / dx; compare to height / width for the rect's diagonal
  if (absDx * r.height >= absDy * r.width) {
    // More horizontal → left or right
    return dx >= 0 ? 'right' : 'left';
  } else {
    // More vertical → top or bottom
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/** A connector endpoint shape (structural, to avoid circular imports). */
type EndpointLike = {
  kind: 'attached';
  objectId: string;
  fallback: Point;
} | {
  kind: 'free';
  x: number;
  y: number;
};

interface ConnectorSnapLike {
  from: EndpointLike;
  to: EndpointLike;
}

/**
 * Resolve the world-space start and end points of a connector from its stored
 * endpoints and the current rects map. Missing targets use their `fallback`.
 */
export function resolveEndpoints(
  c: ConnectorSnapLike,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromPt = resolvePoint(c.from, rects, c.to);
  const toPt = resolvePoint(c.to, rects, c.from);
  return { from: fromPt, to: toPt };
}

function resolvePoint(
  endpoint: EndpointLike,
  rects: ReadonlyMap<string, Rect>,
  otherEndpoint: EndpointLike,
): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  // attached
  const rect = rects.get(endpoint.objectId);
  if (!rect) {
    // Orphaned: target missing, use fallback
    return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  }
  // Determine the other end's position for nearest-side calculation
  let otherPoint: Point;
  if (otherEndpoint.kind === 'free') {
    otherPoint = { x: otherEndpoint.x, y: otherEndpoint.y };
  } else {
    const otherRect = rects.get(otherEndpoint.objectId);
    if (otherRect) {
      otherPoint = { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
    } else {
      // Other target also missing — use its fallback
      otherPoint = { x: otherEndpoint.fallback.x, y: otherEndpoint.fallback.y };
    }
  }
  const side = nearestSide(rect, otherPoint);
  return sideAnchor(rect, side);
}

/** Axis-aligned bounding box containing both points (with zero minimum size). */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}
