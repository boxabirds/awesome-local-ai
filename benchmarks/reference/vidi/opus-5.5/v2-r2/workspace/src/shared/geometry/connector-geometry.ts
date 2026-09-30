// Pure connector geometry: side anchors, nearest side and endpoint resolution. World units.
import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** What `resolveEndpoints` needs from a connector snapshot. */
export interface ConnectorEnds {
  from: Endpoint;
  to: Endpoint;
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Midpoint of a side of `r` (also on the outline of an ellipse or diamond drawn in `r`). */
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
 * The side of `r` facing `toward`: the direction from the centre is compared with
 * the rect's diagonals (exactly on a diagonal counts as left/right).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Where an end points at before its side is known: an object's centre, a fallback or a free point. */
export function reference(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCentre(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  // Orphaned: the target vanished (concurrent delete) → drawn at the stored fallback.
  if (!r) return e.fallback;
  return sideAnchor(r, nearestSide(r, reference(other, rects)));
}

/**
 * Current end points: attached ends sit on the side of their object facing the
 * other end (recomputed from the current rects on every call); missing objects
 * resolve to the stored fallback.
 */
export function resolveEndpoints(c: ConnectorEnds, rects: ReadonlyMap<string, Rect>): { from: Point; to: Point } {
  return { from: resolveEnd(c.from, c.to, rects), to: resolveEnd(c.to, c.from, rects) };
}

/** Bounding box of a straight connector. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
