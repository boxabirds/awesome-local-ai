// Where an arrow attaches to a board object (story 10 `connector.model`).
//
// An attached end stores only the *object*; the exact point is recomputed from that
// object's current rectangle every time the board renders. That is what lets an
// arrow follow a shape that anyone — local or remote — has moved or resized, without
// a single write, and why an end can switch from one side of a shape to another.
//
// The side anchors are the midpoints of the rectangle's four sides, which lie on the
// boundary of a rectangle, an ellipse and a diamond alike.

import type { Point, Rect } from '../geometry.ts';
import type { Endpoint } from '../objects/connector.ts';

/** The four sides of a rectangle, in clockwise order from the top. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The midpoint of one side of `r`. */
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
 * The side of `r` that faces `toward` — the side whose midpoint the line to
 * `toward` crosses first. Compared with cross-multiplication (`|dx| * height`
 * against `|dy| * width`) so the exact aspect ratio of a non-square object decides
 * the side, with no square root and no dependence on the distance.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The point on `r`'s boundary that faces `toward`. */
export function sideAnchorToward(r: Rect, toward: Point): Point {
  return sideAnchor(r, nearestSide(r, toward));
}

/**
 * The two points an arrow is drawn between. Each attached end faces the *centre* of
 * the object at the other end (so the pair of anchors is a property of the two
 * objects, not of whichever end is read first); a free end is its own point; and an
 * end whose object has vanished — deleted concurrently, or never in the board — is
 * drawn at the `fallback` point stored when it was attached.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: endDrawPoint(c.from, c.to, rects),
    to: endDrawPoint(c.to, c.from, rects),
  };
}

function rawPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  // The centre of the target is the direction hint for the other end's side.
  const rect = rects.get(e.objectId);
  if (!rect) return e.fallback;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function endDrawPoint(
  e: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rects.get(e.objectId);
  if (!rect) return e.fallback; // orphaned: drawn where it was attached
  return sideAnchorToward(rect, rawPoint(other, rects));
}

/**
 * The axis-aligned box an arrow covers — what the generic selection bounding box and
 * the marquee use. Zero-width or zero-height when the arrow is exactly vertical or
 * horizontal, which is why the board snapshot keeps a floor on derived extents.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** The length of an arrow, in board units. */
export function connectorLength(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}
