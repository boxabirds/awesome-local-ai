import type { Point } from '@client/canvas/camera';
import type { Rect } from '../geometry';
import type { Endpoint } from '@shared/objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Midpoint of the given side of the rect (on the boundary of rect, ellipse and diamond alike). */
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
 * Side of `r` nearest `toward`: compares the direction vector from the rect's centre
 * against the rect's diagonals (aspect-aware). Ties resolve to the horizontal sides.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return 'right';
  const hx = Math.abs(dx) * r.height;
  const hy = Math.abs(dy) * r.width;
  if (hx > hy) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** Resolved anchor of an endpoint: free points as-is, attached at the side nearest `toward`, missing targets at their fallback. */
export function endpointAnchor(e: Endpoint, rects: ReadonlyMap<string, Rect>, toward: Point): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return { x: e.fallback.x, y: e.fallback.y };
  return sideAnchor(r, nearestSide(r, toward));
}

/** Point used as the "other end" when choosing a side: rect centre for attached, the point itself for free, fallback when missing. */
export function endpointCandidate(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return { x: e.fallback.x, y: e.fallback.y };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Resolve both endpoints of a connector from the current object rectangles.
 * Recomputed on every snapshot so local or remote moves redraw attachments
 * without any writes; a missing target draws at its stored fallback.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const toToward = endpointCandidate(c.to, rects);
  const fromToward = endpointCandidate(c.from, rects);
  return {
    from: endpointAnchor(c.from, rects, toToward),
    to: endpointAnchor(c.to, rects, fromToward),
  };
}

/** Axis-aligned bounding rect spanning two points (zero width/height for straight lines). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
