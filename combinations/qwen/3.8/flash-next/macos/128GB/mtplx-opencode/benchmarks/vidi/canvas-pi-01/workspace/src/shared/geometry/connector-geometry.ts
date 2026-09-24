/**
 * Story 10 · connector geometry (design "Connector geometry").
 *
 * Where an arrow touches a shape is *derived*, never stored: the endpoint keeps
 * only the object id (plus a fallback point for an orphaned arrow), and the side
 * it attaches to is recomputed from the two live rectangles every time it is
 * drawn. That is what makes an arrow follow a moved or resized object, and what
 * lets a rotated-looking relationship switch sides at the rectangle's diagonal.
 *
 * No DOM, no Yjs, no React: everything here is pure and testable in node.
 */
import type { Rect } from '../geometry';
import type { Point } from '../geometry';

/** The four sides an arrow can attach to. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * Where an endpoint sits.
 *
 * `attached` names the object and remembers `fallback`, the anchor point it was
 * created at: the only thing drawn when the target vanished concurrently (an
 * orphaned arrow) and the seed used by {@link detachConnectorsTo}. A moved
 * object never changes it — the drawn point is always recomputed.
 */
export type ConnectorEndpoint =
  | { readonly kind: 'attached'; readonly objectId: string; readonly fallback: Point }
  | { readonly kind: 'free'; readonly x: number; readonly y: number };

/** The part of a connector snapshot this module needs. */
export interface ConnectorGeometry {
  readonly from: ConnectorEndpoint;
  readonly to: ConnectorEndpoint;
}

/** The midpoint of `side` — the point an arrow touches. */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
    default:
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
}

/**
 * The side of `rect` whose midpoint is closest to `toward` — "nearest side"
 * taken literally. For a square that is the 45° switch the PRD describes
 * (44° right, 46° top); for a wide rect the top face is correspondingly
 * narrower, because its midpoint sits farther from the corners. Distance also
 * answers for a point *inside* the rect, where a diagonal test has no
 * meaningful side, and it never divides (so a flat rect yields no NaN).
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  // Degenerate rect: every midpoint coincides, so any answer is arbitrary but
  // must still be a side (a zero-size object is never an anchor).
  if (rect.width <= 0 && rect.height <= 0) return 'right';
  let best: Side = 'right';
  let bestDistance = Infinity;
  // Fixed order, so a tie (a point exactly on a diagonal) resolves the same way
  // for every caller and on every machine.
  for (const side of ['right', 'left', 'bottom', 'top'] as const) {
    const anchor = sideAnchor(rect, side);
    const dx = toward.x - anchor.x;
    const dy = toward.y - anchor.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = side;
    }
  }
  return best;
}

/**
 * The best available stand-in for an endpoint while the *other* end's side is
 * being chosen: a loose point as-is, an attached end as the centre of its live
 * rectangle, and an orphaned attachment as its stored fallback point.
 */
function referencePoint(end: ConnectorEndpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  // Orphaned: the stored fallback point is the direction reference too.
  if (!rect) return { x: end.fallback.x, y: end.fallback.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Resolve both endpoints of `c` against the live `rects` (id → rectangle).
 *
 *  - a free endpoint is its stored point;
 *  - an attached endpoint whose object is gone is its stored fallback point;
 *  - an attached endpoint whose object is live is the midpoint of the side of
 *    that object's rectangle that faces the other end.
 */
export function resolveEndpoints(
  c: ConnectorGeometry,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const towardFrom = referencePoint(c.from, rects);
  const towardTo = referencePoint(c.to, rects);

  const pointFor = (end: ConnectorEndpoint, toward: Point): Point => {
    if (end.kind === 'free') return { x: end.x, y: end.y };
    const rect = rects.get(end.objectId);
    if (!rect) return { x: end.fallback.x, y: end.fallback.y };
    return sideAnchor(rect, nearestSide(rect, toward));
  };

  return { from: pointFor(c.from, towardTo), to: pointFor(c.to, towardFrom) };
}

/**
 * The axis-aligned box covering both ends. A perfectly horizontal or vertical
 * arrow therefore has a zero-height or zero-width box, which is fine: it is used
 * for marquee containment and the selection frame, not for the line's own hit
 * test (that is a distance question — see `distanceToPolyline`).
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}
