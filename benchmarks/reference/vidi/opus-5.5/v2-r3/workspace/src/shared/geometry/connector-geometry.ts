// Pure connector geometry (story 10, connector.model): side anchors, the
// nearest side toward a point, and live endpoint resolution. World units.
import { normalizeRect, type Point, type Rect } from '../geometry';
import type { ConnectorSnap, Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

const HALF = 2;

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** Midpoint of a side: on the boundary of a rectangle, ellipse and diamond alike. */
export function sideAnchor(r: Rect, s: Side): Point {
  const c = rectCentre(r);
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
 * The side facing `toward`: the direction from the centre is compared with the
 * rect's diagonals (exactly on a diagonal counts as left/right).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The anchor an attached end uses when its object sits at `r` and the other end is at `toward`. */
export function anchorToward(r: Rect, toward: Point): Point {
  return sideAnchor(r, nearestSide(r, toward));
}

/** Where the end points at before sides are chosen: the object's centre, or the fixed point. */
function referencePoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCentre(r) : e.fallback;
}

function resolveEnd(e: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  // Orphaned: the target vanished (e.g. deleted concurrently) — draw at the stored anchor.
  return r ? anchorToward(r, other) : e.fallback;
}

/** Resolves both ends from the objects' current rects (no writes; sides recomputed every call). */
export function resolveEndpointPair(
  from: Endpoint,
  to: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromRef = referencePoint(from, rects);
  const toRef = referencePoint(to, rects);
  return { from: resolveEnd(from, toRef, rects), to: resolveEnd(to, fromRef, rects) };
}

export function resolveEndpoints(
  c: Pick<ConnectorSnap, 'from' | 'to'>,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return resolveEndpointPair(c.from, c.to, rects);
}

export function connectorBBox(from: Point, to: Point): Rect {
  return normalizeRect(from, to);
}
