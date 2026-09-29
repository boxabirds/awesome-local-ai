import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

/**
 * Connector endpoint geometry (story 10). Pure functions — no Yjs, no
 * config imports beyond types — so both the shared models and the client
 * can resolve endpoint positions without a dependency cycle.
 *
 * Endpoint semantics (conn.anchoring):
 * - a FREE endpoint is drawn at its stored point;
 * - an ATTACHED endpoint is drawn at the MIDPOINT of the side of its object
 *   that faces the other endpoint (nearestSide);
 * - an ORPHANED attached endpoint (object deleted concurrently) is drawn at
 *   its fallback — the anchor computed at attach time (connector.target_deleted).
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The side of `rect` whose outward normal best faces `toward`. The
 * direction is compared against the rect's diagonal: when
 * |dx| * height >= |dy| * width the horizontal normal wins, so a square
 * switches at exactly 45 degrees (TC-10).
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) * rect.height >= Math.abs(dy) * rect.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/** Midpoint of one side of `rect` (the anchor a connector attaches to). */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

/**
 * Resolves both endpoints of a connector to world points against the given
 * rects (id -> current object rect). A missing rect means the object is
 * gone (orphaned): the stored fallback anchor is used instead.
 */
export function resolveEndpoints(
  connector: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const otherPoint = (ep: Endpoint): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const rect = rects.get(ep.objectId);
    if (rect !== undefined) {
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return { x: ep.fallback.x, y: ep.fallback.y };
  };
  const resolveOne = (ep: Endpoint, other: Endpoint): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const rect = rects.get(ep.objectId);
    if (rect === undefined) return { x: ep.fallback.x, y: ep.fallback.y };
    return sideAnchor(rect, nearestSide(rect, otherPoint(other)));
  };
  return {
    from: resolveOne(connector.from, connector.to),
    to: resolveOne(connector.to, connector.from),
  };
}

/** Axis-aligned bounding box of the segment (degenerate when zero-length). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
