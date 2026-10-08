import type { Point, Rect } from './types'

/**
 * The four sides of a rectangle. A connector end attaches to the midpoint of
 * one of these (the side nearest the other end of the arrow).
 */
export type Side = 'top' | 'right' | 'bottom' | 'left'

/** Endpoint of a connector (see story 10 design). Re-declared here so the
 *  pure geometry has no dependency on the persisted model module. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number }

/** Minimal view of a connector needed to resolve its drawn endpoints. */
export interface ConnectorEnds {
  from: Endpoint
  to: Endpoint
}

/** Midpoint of one side of `r`. This point lies on the boundary of a rect,
 *  an ellipse and a diamond, which is why the same anchor works for all three
 *  shape kinds. */
export function sideAnchor(r: Rect, s: Side): Point {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  switch (s) {
    case 'top':
      return { x: cx, y: r.y }
    case 'bottom':
      return { x: cx, y: r.y + r.height }
    case 'left':
      return { x: r.x, y: cy }
    case 'right':
      return { x: r.x + r.width, y: cy }
  }
}

/**
 * The side of `r` whose midpoint is nearest `toward`, chosen by comparing the
 * direction from the rect centre with the rect's diagonals: when the horizontal
 * offset dominates the arrow attaches left/right, otherwise top/bottom. This is
 * the boundary that makes arrows switch sides as objects move past each other.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }
  return dy >= 0 ? 'bottom' : 'top'
}

/** Representative point used to decide which side a *target* object faces:
 *  a free end's own point, or the centre of an attached object (its fallback
 *  when the object is gone). */
function aimPoint(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y }
  const r = rects.get(end.objectId)
  if (!r) return end.fallback
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/**
 * Resolve the two drawn points of a connector from its stored endpoints and the
 * current rectangles of every object. Attached ends are recomputed from the
 * object's *current* rectangle every call — so a move or resize by anyone
 * redraws the arrow and switches its side, with no extra writes. A missing
 * target (concurrent delete) falls back to the stored `fallback` point.
 */
export function resolveEndpoints(
  c: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const toAim = aimPoint(c.to, rects)
  const fromAim = aimPoint(c.from, rects)

  return {
    from: resolveEnd(c.from, rects, toAim),
    to: resolveEnd(c.to, rects, fromAim),
  }
}

function resolveEnd(
  end: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  toward: Point,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y }
  const r = rects.get(end.objectId)
  if (!r) return end.fallback
  return sideAnchor(r, nearestSide(r, toward))
}

/** Axis-aligned bounding box spanning the two endpoints (used for the
 *  connector's stored bbox and coarse culling). */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x)
  const y = Math.min(from.y, to.y)
  return {
    x,
    y,
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  }
}
