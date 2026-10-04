/**
 * Story 10: where an arrow attaches, and where it is drawn.
 *
 * An arrow stores its two ends, not a path: each end is either attached to an
 * object or free in space. Everything the board draws or hits a pointer against —
 * the line, its bounding box, the dot at its head — is derived from those two
 * ends and the current boxes of the objects they point at, so moving a shape moves
 * the arrow with it without a single extra write.
 *
 * The rule for an attached end (PRD connector.snap) is the midpoint of the side of
 * its object that faces the other end. Which side faces the other end is decided by
 * the object's own diagonals, so the answer flips where a viewer expects it to flip
 * and never wanders between two answers near them.
 */

import type { Point, Rect } from '../geometry';
import type { ConnectorEndpoint } from '../objects/connector';

/** The four sides of a box, as an arrow sees them. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The side of `r` that faces `toward`.
 *
 * The centre and the two diagonals cut the box into four wedges; the wedge the
 * other end sits in is the side that faces it. Comparing `|dx| * height` with
 * `|dy| * width` is exactly "which side of both diagonals is it on", without any
 * trigonometry — so a wide rectangle turns left/right sooner than a tall one,
 * which is what the shape looks like.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return 'top';
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** The midpoint of one side of `r`. Side midpoints lie on the outline of a rect,
 * an ellipse and a diamond alike, so the same anchor works for every shape kind
 * (and for a sticky note). */
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
 * Where an end points, given the boxes of the objects on the board.
 *
 * An attached end whose object is still there anchors to that object's facing
 * side; one whose object is gone (deleted while the arrow lived) falls back to the
 * board position stored with it, so the arrow stays visible and still draggable.
 */
export function endpointPosition(
  end: ConnectorEndpoint,
  otherEnd: Point,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect) return { x: end.fallbackX, y: end.fallbackY };
  return sideAnchor(rect, nearestSide(rect, otherEnd));
}

/**
 * What an end faces when deciding which side to sit on: the middle of the object
 * the other end is attached to, or the other end's own position when it is free or
 * its object is gone.
 *
 * Facing the other object's *centre*, rather than its already-resolved anchor, is
 * what keeps the pair stable: the two ends never chase each other into a side that
 * flips back and forth as the objects move.
 */
export function oppositeReference(
  end: ConnectorEndpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect) return { x: end.fallbackX, y: end.fallbackY };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Where both ends of an arrow are drawn, as a pair.
 *
 * Each end faces the other one; the pair is what the arrow is drawn from, what the
 * marquee box is made of, and what a pointer is measured against when selecting.
 */
export function resolveEndpoints(
  connector: { from: ConnectorEndpoint; to: ConnectorEndpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: endpointPosition(connector.from, oppositeReference(connector.to, rects), rects),
    to: endpointPosition(connector.to, oppositeReference(connector.from, rects), rects),
  };
}

/** The stored position of an end, whatever kind it is: the fallback of an
 * attached end, or its own point when free. */
export function pointOf(end: ConnectorEndpoint): Point {
  return end.kind === 'free' ? { x: end.x, y: end.y } : { x: end.fallbackX, y: end.fallbackY };
}

/** The box an arrow occupies: the two ends, squared up. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
