import type { Endpoint } from '../objects/connector';
import { normalizeRect, type Point, type Rect } from '../geometry';

/**
 * Connector geometry (story 10): where an arrow end sits on an object, and the
 * bounding box that follows from it. Pure, framework-free and write-free —
 * recomputing the ends from the *current* rectangles on every snapshot is what
 * makes arrows follow objects moved by anyone, with no document writes.
 */

/** The four sides of a rectangle, in the order their dots are drawn. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The midpoint of one side — a point on the boundary of a rect, ellipse and diamond alike. */
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
 * The side of `r` nearest `toward`, found by comparing the direction from the
 * rectangle's centre with its diagonals: a direction steeper than the diagonal
 * leaves through the top or the bottom, a shallower one through the left or the
 * right. For a square that is the 45° line; for a wide shape the top and bottom
 * take over sooner, which is what keeps arrows perpendicular to the shape.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const halfWidth = r.width / 2;
  const halfHeight = r.height / 2;
  const dx = toward.x - (r.x + halfWidth);
  const dy = toward.y - (r.y + halfHeight);
  const vertical = Math.abs(dy) * halfWidth > Math.abs(dx) * halfHeight;
  if (vertical) return dy < 0 ? 'top' : 'bottom';
  return dx < 0 ? 'left' : 'right';
}

/** The centre of a rectangle. */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Where an endpoint points at, ignoring which side of it the arrow would use:
 * a free end's own point, an attached end's object centre, and the stored
 * fallback when that object is gone (a concurrent delete).
 */
export function endpointReference(
  end: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (rect === undefined) return { x: end.fallback.x, y: end.fallback.y };
  return rectCenter(rect);
}

/**
 * The point an arrow end draws at: the midpoint of the side of its object
 * nearest the other end, the fixed point of a free end, or the stored fallback
 * of an attached end whose object is gone (rendered there, never thrown at).
 */
export function endpointPoint(
  end: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  otherEnd: Endpoint,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (rect === undefined) return { x: end.fallback.x, y: end.fallback.y };
  return sideAnchor(rect, nearestSide(rect, endpointReference(otherEnd, rects)));
}

/**
 * Both ends of a connector, resolved against the current object rectangles.
 * Takes the two endpoints (a `ConnectorSnapshot` satisfies it), so a renderer
 * or a test can resolve an arrow from its ends alone.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: endpointPoint(c.from, rects, c.to),
    to: endpointPoint(c.to, rects, c.from),
  };
}

/** The axis-aligned box enclosing an arrow, used as its object bounds. */
export function connectorBBox(from: Point, to: Point): Rect {
  return normalizeRect(from, to);
}
