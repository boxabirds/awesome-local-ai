import type { Point, Rect } from '../geometry';

/**
 * Connector geometry: side anchors, nearest side computation, endpoint resolution, bbox.
 *
 * All coordinates are in world units. Functions are pure and never throw.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Return the midpoint of the given side of a rect.
 * This is the connection point (anchor) for that side.
 * Works for rect, ellipse, and diamond (on the boundary for each).
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
 * Determine which side of `r` is nearest to the point `toward`.
 *
 * Uses the angle from the rect's centre to `toward`:
 * - The side whose normal is most aligned with the direction vector wins.
 * - At the 45° diagonal boundary, the switch occurs: at exactly 45° from centre
 *   of a square, both horizontal and vertical sides are equidistant; the convention
 *   is that angles in [45°, 135°) are 'top', etc.
 *
 * For non-square rects, the diagonal comparison uses the half-width and half-height
 * to find the correct side the line from centre to `toward` exits through.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // If toward is at the centre, default to 'right'
  if (dx === 0 && dy === 0) return 'right';

  const halfW = r.width / 2;
  const halfH = r.height / 2;

  // Determine which pair (horizontal vs vertical) the direction vector falls in.
  // The diagonals of the rect divide the plane into four regions.
  // For a line from centre to (dx, dy), the ratio |dx|/halfW vs |dy|/halfH
  // determines whether it exits through a horizontal or vertical side.
  // |dx| * halfH vs |dy| * halfW:
  //   if |dx| * halfH >= |dy| * halfW → exits through left or right
  //   else → exits through top or bottom
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx * halfH >= absDy * halfW) {
    // Exits through right (dx > 0) or left (dx < 0)
    return dx > 0 ? 'right' : 'left';
  } else {
    // Exits through top (dy < 0) or bottom (dy > 0)
    return dy < 0 ? 'top' : 'bottom';
  }
}

/** Connector snapshot type needed for resolveEndpoints (minimal fields). */
export interface ConnectorEndpointSnap {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

export interface ConnectorFreeEndpointSnap {
  kind: 'free';
  x: number;
  y: number;
}

export type ConnectorEndpointAny = ConnectorEndpointSnap | ConnectorFreeEndpointSnap;

export interface ConnectorResolveInput {
  from: ConnectorEndpointAny;
  to: ConnectorEndpointAny;
}

/**
 * Resolve the world-space start and end points of a connector.
 *
 * For attached ends: compute the nearest side anchor from the current rect.
 * For free ends: return the stored point.
 * For orphaned ends (attached but target not in rects): return the stored fallback.
 */
export function resolveEndpoints(
  c: ConnectorResolveInput,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = resolveEndpoint(c.from, c.to, rects);
  const to = resolveEndpoint(c.to, c.from, rects);
  return { from, to };
}

function resolveEndpoint(
  end: ConnectorEndpointAny,
  otherEnd: ConnectorEndpointAny,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') {
    return { x: end.x, y: end.y };
  }

  // Attached: find the target's rect
  const rect = rects.get(end.objectId);
  if (!rect) {
    // Orphaned: target missing, use fallback
    return { x: end.fallback.x, y: end.fallback.y };
  }

  // Get the other end's point to determine which side is nearest
  const otherPoint = otherEnd.kind === 'free'
    ? { x: otherEnd.x, y: otherEnd.y }
    : (() => {
        const r = rects.get(otherEnd.objectId);
        return r
          ? { x: r.x + r.width / 2, y: r.y + r.height / 2 }
          : { x: otherEnd.fallback.x, y: otherEnd.fallback.y };
      })();

  const side = nearestSide(rect, otherPoint);
  return sideAnchor(rect, side);
}

/**
 * Compute the bounding box of a connector given its resolved endpoints.
 * Returns a zero-size rect if both points are the same.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
}
