/**
 * Pure connector geometry (story 10, connector.model).
 *
 * All values are world units. Functions are pure and total.
 */

import type { Point } from '../../client/canvas/camera';
import type { Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

/** The four sides of a rectangle. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The midpoint of side `s` of rect `r`. For all three shape kinds
 * (rect, ellipse, diamond) the side midpoints lie on the boundary.
 */
export function sideAnchor(r: Rect, s: Side): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  switch (s) {
    case 'top': return { x: cx, y: r.y };
    case 'right': return { x: r.x + r.width, y: cy };
    case 'bottom': return { x: cx, y: r.y + r.height };
    case 'left': return { x: r.x, y: cy };
  }
}

/**
 * The side of rect `r` nearest to point `toward`.
 *
 * Compares the direction vector from the rect's centre to `toward` against
 * the rect's diagonals: if the direction is "more horizontal" (|dx|/hw >
 * |dy|/hh) the nearest side is left or right; otherwise top or bottom.
 *
 * For a square this switches at exactly 45°.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  const hw = r.width / 2;
  const hh = r.height / 2;

  // Normalise by half-extents so the diagonal is at 45° regardless of aspect.
  const normX = hw > 0 ? Math.abs(dx) / hw : 0;
  const normY = hh > 0 ? Math.abs(dy) / hh : 0;

  if (normX > normY) {
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy > 0 ? 'bottom' : 'top';
  }
}

/**
 * Resolve both endpoints of a connector to world-space points.
 *
 * For each endpoint:
 *  - `attached`: look up the target's current rect in `rects`; the anchor is
 *    `sideAnchor(rect, nearestSide(rect, otherAnchor))`. If the target is
 *    missing from `rects` (concurrent delete), use the stored `fallback`.
 *  - `free`: use the stored point directly.
 *
 * No writes: remote moves/resizes redraw automatically on the next render.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return { from: resolveOne(c.from, c.to, rects), to: resolveOne(c.to, c.from, rects) };
}

function resolveOne(
  ep: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };

  // Attached: find the target's rect.
  const targetRect = rects.get(ep.objectId);
  if (targetRect === undefined) {
    // Orphaned (concurrent delete): use the fallback point.
    return { x: ep.fallback.x, y: ep.fallback.y };
  }

  // The "other" end's resolved point (used to determine which side to anchor to).
  // We resolve the other end first (it may also be attached, in which case we
  // use its rect's centre as the "toward" point).
  const otherPoint = other.kind === 'free'
    ? { x: other.x, y: other.y }
    : (() => {
        const otherRect = rects.get(other.objectId);
        if (otherRect === undefined) {
          return { x: other.fallback.x, y: other.fallback.y };
        }
        return { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
      })();

  const side = nearestSide(targetRect, otherPoint);
  return sideAnchor(targetRect, side);
}

/**
 * Axis-aligned bounding box spanning both endpoints.
 * Used by the snapshot to derive the connector's x/y/width/height.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
