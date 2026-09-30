// Where arrows meet the objects they are attached to (story 10). Pure, world units.
//
// Attached ends store no side: every render picks the side of the object nearest the other end,
// so arrows follow moves (local or remote) and switch sides without any writes.
import { type Point, type Rect, normalizeRect } from '../geometry';
import type { ConnectorSnap, Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Midpoint of a side: on the outline of a rectangle, an ellipse and a diamond alike. */
export function sideAnchor(r: Rect, s: Side): Point {
  const c = rectCenter(r);
  switch (s) {
    case 'top':
      return { x: c.x, y: r.y };
    case 'bottom':
      return { x: c.x, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: c.y };
    case 'right':
      return { x: r.x + r.width, y: c.y };
  }
}

/**
 * The side facing `toward`: the direction from the rect's centre is compared with the rect's
 * diagonals (exactly on a diagonal counts as left/right).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy < 0 ? 'top' : 'bottom';
}

/** The point an end aims at when choosing the other end's side: an object's centre or a fixed point. */
function referencePoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCenter(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  // Orphaned: the object vanished (deleted concurrently); draw at the point stored on attach.
  if (!r) return e.fallback;
  return sideAnchor(r, nearestSide(r, referencePoint(other, rects)));
}

/** Both ends of an arrow from the current object rects. Never throws for missing objects. */
export function resolveEndpoints(
  c: Pick<ConnectorSnap, 'from' | 'to'>,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

export function connectorBBox(from: Point, to: Point): Rect {
  return normalizeRect(from, to);
}
