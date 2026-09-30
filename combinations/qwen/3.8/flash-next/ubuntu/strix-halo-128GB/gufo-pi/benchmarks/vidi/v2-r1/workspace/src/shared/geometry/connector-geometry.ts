/**
 * Connector geometry: side anchors, nearest-side computation, endpoint resolution,
 * and connector bounding boxes. No DOM, no React.
 */

import type { Point } from '../board-model';
import type { Rect } from '../geometry';
import type { ConnectorSnap } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Return the midpoint of the given side of a rect.
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
 * Determine which side of rect `r` is nearest to point `toward`.
 * Uses the direction vector from the centre of the rect to `toward` and
 * compares its angle against the diagonals.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // If the point is at the centre, default to 'right'
  if (dx === 0 && dy === 0) return 'right';

  // Compare the absolute angle of the vector to the diagonal angle
  // The diagonals of the rect have slope height/width
  // If |dy| * width <= |dx| * height, the vector exits through left or right
  // Otherwise it exits through top or bottom
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx * r.height <= absDy * r.width) {
    // Exits through top or bottom (angle is closer to vertical than the diagonal)
    return dy < 0 ? 'top' : 'bottom';
  } else {
    // Exits through left or right
    return dx < 0 ? 'left' : 'right';
  }
}

/**
 * Resolve the two endpoints of a connector to world-space points,
 * given the current rects map of all objects on the board.
 *
 * For attached endpoints: computes the anchor at the nearest side of the target object.
 * If the target object is missing (deleted concurrently, orphaned): uses the stored fallback.
 * For free endpoints: uses the stored x, y.
 */
export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = resolveEndpoint(c.from, c.to, rects);
  const to = resolveEndpoint(c.to, c.from, rects);
  return { from, to };
}

function resolveEndpoint(
  endpoint: ConnectorSnap['from'],
  otherEndpoint: ConnectorSnap['from'],
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }

  // Attached: find the rect of the target object
  const rect = rects.get(endpoint.objectId);
  if (rect === undefined) {
    // Orphaned: use fallback
    return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  }

  // Determine the "toward" point: the resolved position of the other end
  const toward = resolvePoint(otherEndpoint, rects);
  const side = nearestSide(rect, toward);
  return sideAnchor(rect, side);
}

/** Resolve a single endpoint to a point (for computing the "toward" value). */
function resolvePoint(
  endpoint: ConnectorSnap['from'],
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  const rect = rects.get(endpoint.objectId);
  if (rect === undefined) {
    return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  }
  // Use the centre of the rect as an approximation for the "toward" calculation
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Compute the bounding box of a connector line between two points.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
}
