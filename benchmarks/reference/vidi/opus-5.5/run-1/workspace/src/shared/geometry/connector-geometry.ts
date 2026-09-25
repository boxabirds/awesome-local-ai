/**
 * Arrow geometry (story 10): side anchors, which side an arrow attaches to, and where an
 * arrow's ends are given the current rectangles of the objects on the board. Pure; world units.
 *
 * Attached ends store no side: the side is recomputed from the live rectangles every time
 * (nearestSide), so arrows switch sides as objects move and follow remote moves without writes.
 */
import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * One end of an arrow: attached to an object (drawn at the midpoint of its side nearest the
 * other end; `fallback` is where it was attached, drawn if the object vanished concurrently),
 * or free, fixed at a board point.
 */
export type Endpoint = { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };

const HALF = 2;

function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** Midpoint of side `s`: on the boundary of a rectangle, an ellipse and a diamond alike. */
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
 * The side of `r` facing `toward`: the direction from the centre is compared with the rect's
 * diagonals. Exactly on a diagonal the left/right side wins; `toward` at the centre gives right.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  // |dy| / |dx| compared with height / width, without dividing.
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy < 0 ? 'top' : 'bottom';
}

/** Point where an arrow end attached to `r` sits when the arrow points at `other`. */
export function attachedAnchor(r: Rect, other: Point): Point {
  return sideAnchor(r, nearestSide(r, other));
}

/** A free end's point, or undefined for an attached end. */
function freePoint(e: Endpoint): Point | undefined {
  return e.kind === 'free' ? { x: e.x, y: e.y } : undefined;
}

/**
 * Where the arrow's two ends are drawn. An attached end whose object is in `rects` sits on the
 * side facing the other end (the other object's centre, or the other free point); an end whose
 * object is missing (deleted concurrently) is drawn at its fallback. Never throws.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const rectOf = (e: Endpoint): Rect | undefined => (e.kind === 'attached' ? rects.get(e.objectId) : undefined);
  const fromRect = rectOf(c.from);
  const toRect = rectOf(c.to);
  // What each end aims at: a free point, a live object's centre, or an orphaned end's fallback.
  const aim = (e: Endpoint, r: Rect | undefined): Point =>
    freePoint(e) ?? (r ? rectCentre(r) : (e as Extract<Endpoint, { kind: 'attached' }>).fallback);
  const fromAim = aim(c.from, fromRect);
  const toAim = aim(c.to, toRect);
  const from = fromRect ? attachedAnchor(fromRect, toAim) : fromAim;
  const to = toRect ? attachedAnchor(toRect, fromAim) : toAim;
  return { from, to };
}

/** Axis-aligned box spanned by an arrow's two ends (zero-sized on an axis the arrow is flat on). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}

/** Parses a stored endpoint; undefined for malformed values (the arrow is then skipped). */
export function readEndpoint(value: unknown): Endpoint | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free' && typeof v.x === 'number' && typeof v.y === 'number' && finite(v.x, v.y)) {
    return { kind: 'free', x: v.x, y: v.y };
  }
  if (v.kind === 'attached' && typeof v.objectId === 'string') {
    const f = v.fallback as Record<string, unknown> | undefined;
    if (f && typeof f.x === 'number' && typeof f.y === 'number' && finite(f.x, f.y)) {
      return { kind: 'attached', objectId: v.objectId, fallback: { x: f.x, y: f.y } };
    }
  }
  return undefined;
}

/** True for a well-formed endpoint with finite coordinates. */
export function isValidEndpoint(e: Endpoint): boolean {
  if (e.kind === 'free') return finite(e.x, e.y);
  return typeof e.objectId === 'string' && e.objectId.length > 0 && finite(e.fallback.x, e.fallback.y);
}
