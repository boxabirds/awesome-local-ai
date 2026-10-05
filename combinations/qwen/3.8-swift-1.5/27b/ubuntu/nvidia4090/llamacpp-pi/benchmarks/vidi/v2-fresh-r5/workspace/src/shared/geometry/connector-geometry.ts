/**
 * Connector geometry (story 10). Pure functions for side anchors,
 * nearest-side selection, endpoint resolution, and bounding boxes.
 */
import type { Rect, Point } from '../geometry';
import type { ObjectSnapshot } from '../board-model';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Return the midpoint of the given side of a rect.
 */
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
 * Determine which side of rect `r` is nearest to point `toward`.
 * Uses the ratio of distance from centre to each side, normalised by half-dimensions.
 * The side with the smallest normalised distance wins. Ties break in favour of
 * the horizontal axis (right/left over top/bottom).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;

  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Normalise by half-dimensions to account for non-square rects
  const normDx = Math.abs(dx) / (r.width / 2 || 1);
  const normDy = Math.abs(dy) / (r.height / 2 || 1);

  if (normDx >= normDy) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/**
 * A connector snapshot with endpoint data.
 */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * Resolve the world-space endpoints of a connector given a map of object rects.
 * - Attached endpoints: compute the side anchor of the target rect facing the other end.
 * - Free endpoints: use the stored point directly.
 * - If an attached target is missing from `rects`, use the stored `fallback`.
 */
export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = resolveOne(c.from, c.to, rects);
  const to = resolveOne(c.to, c.from, rects);
  return { from, to };
}

function resolveOne(
  end: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') {
    return { x: end.x, y: end.y };
  }

  const rect = rects.get(end.objectId);
  if (!rect) {
    // Orphaned: target missing, use fallback
    return { ...end.fallback };
  }

  // Determine the "toward" point: the other endpoint's resolved position
  // (use its fallback or free position as a proxy for direction)
  const toward = other.kind === 'free'
    ? { x: other.x, y: other.y }
    : rects.has(other.objectId)
      ? { x: rects.get(other.objectId)!.x + rects.get(other.objectId)!.width / 2, y: rects.get(other.objectId)!.y + rects.get(other.objectId)!.height / 2 }
      : { ...other.fallback };

  const side = nearestSide(rect, toward);
  return sideAnchor(rect, side);
}

/**
 * Compute the bounding box of a connector line from point `from` to point `to`.
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
