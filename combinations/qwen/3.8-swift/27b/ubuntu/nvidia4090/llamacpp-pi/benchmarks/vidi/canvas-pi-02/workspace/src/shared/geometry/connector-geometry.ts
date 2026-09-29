// Pure connector geometry (story 10, connector.model): side anchors,
// nearest-side selection, endpoint resolution and the connector bounding
// box. No DOM, no React, no Yjs.

import type { Point, Rect } from '../geometry';

/** The four sides of an object's bounding box. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The two connector endpoints as stored by the model. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The midpoint of one side of `r` (on the boundary of rect, ellipse and
 *  diamond alike). */
export function sideAnchor(r: Rect, s: Side): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  switch (s) {
    case 'top':
      return { x: cx, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: cy };
    case 'bottom':
      return { x: cx, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: cy };
  }
}

/**
 * The side of `r` nearest to `toward`: the direction vector from the
 * rectangle centre is compared against the rectangle's diagonals (a 45°
 * switch in normalised space).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  // Normalise by the rectangle dimensions: the direction vector is
  // compared against the diagonals (a 45° switch in normalised space),
  // which matches the side a human sees for any aspect ratio.
  if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Resolves a connector's endpoints to world points from the LIVE rectangles
 * of its targets: an attached end sits on the side of its object nearest
 * the other end and re-resolves on every call (so moves/resizes by anyone
 * redraw the arrow without writes — connector.follow); a missing target
 * (concurrent delete) falls back to the stored `fallback` point
 * (connector.target_deleted); a free end is its stored point.
 */
function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function anchorOf(e: Endpoint, ownRect: Rect | undefined, otherPoint: Point): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  if (ownRect === undefined) return e.fallback; // target vanished: the stored anchor
  return sideAnchor(ownRect, nearestSide(ownRect, otherPoint));
}

export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromRect = c.from.kind === 'attached' ? rects.get(c.from.objectId) : undefined;
  const toRect = c.to.kind === 'attached' ? rects.get(c.to.objectId) : undefined;
  const fromToward = c.to.kind === 'attached' ? (toRect !== undefined ? center(toRect) : c.to.fallback) : c.to;
  const toToward = c.from.kind === 'attached' ? (fromRect !== undefined ? center(fromRect) : c.from.fallback) : c.from;
  return {
    from: anchorOf(c.from, fromRect, fromToward),
    to: anchorOf(c.to, toRect, toToward),
  };
}

/** The bounding box of the two resolved endpoints (a straight line). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
