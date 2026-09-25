/**
 * Where arrows meet objects (anchor: connector.model). Pure, world units.
 *
 * An attached end sits on the midpoint of the side of its object that faces the other end.
 * Sides are never stored: they are recomputed from the current rects on every snapshot, so
 * an arrow follows (and switches sides) whoever moved the object. Side midpoints lie on the
 * outline of a rectangle, an ellipse and a diamond alike.
 */
import type { Point, Rect } from '../geometry';
import type { ConnectorSnap, Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

const HALF = 2;

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** Midpoint of one side of `r`. */
export function sideAnchor(r: Rect, s: Side): Point {
  const c = rectCentre(r);
  switch (s) {
    case 'top':
      return { x: c.x, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: c.y };
    case 'bottom':
      return { x: c.x, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: c.y };
  }
}

/**
 * The side of `r` facing `toward`: the direction from the centre is compared with the
 * rect's diagonals (exactly on a diagonal counts as left/right).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  // |dx| / (w/2) >= |dy| / (h/2), without dividing by a zero size.
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) {
    if (dx === 0 && dy !== 0) return dy < 0 ? 'top' : 'bottom';
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

/** Anchor of an attached end on `r`, facing `toward`. */
export function anchorToward(r: Rect, toward: Point): Point {
  return sideAnchor(r, nearestSide(r, toward));
}

/** Point the *other* end uses to choose its side: a free point, the attached object's centre, or a missing object's fallback. */
function referencePoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r === undefined ? e.fallback : rectCentre(r);
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  // Orphaned: the object vanished (deleted concurrently); draw where it was attached.
  if (r === undefined) return e.fallback;
  return anchorToward(r, referencePoint(other, rects));
}

/** Both ends of an arrow from the current object rects. Never throws. */
export function resolveEndpoints(
  c: Pick<ConnectorSnap, 'from' | 'to'>,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

/** Axis-aligned box spanned by the two ends (zero-sized along an axis for straight lines). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
