import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The anchor point on the midpoint of a given side of a rect.
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
 *
 * Uses the direction vector from the rect's centre to `toward` and compares
 * it against the rect's diagonal to decide between horizontal and vertical
 * sides, then picks the correct half.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Compare |dx|/halfW vs |dy|/halfH to decide horizontal vs vertical.
  // This is equivalent to checking against the 45° diagonals of the rect.
  const halfW = r.width / 2;
  const halfH = r.height / 2;

  if (halfW === 0 && halfH === 0) return 'right';
  if (halfW === 0) return dy >= 0 ? 'bottom' : 'top';
  if (halfH === 0) return dx >= 0 ? 'right' : 'left';

  const ratio = Math.abs(dx) / halfW;
  const ratioY = Math.abs(dy) / halfH;

  if (ratio > ratioY) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/**
 * A connector endpoint in the doc.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * A connector snapshot (render-ready).
 */
export interface ConnectorSnap {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
}

/**
 * Resolve the actual screen/world positions of a connector's endpoints from
 * the current rects of all objects. Attached endpoints are placed at the
 * midpoint of the nearest side; free endpoints use their stored position;
 * orphaned endpoints (target missing) use their fallback.
 */
export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const resolve = (ep: Endpoint, other: Point): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const r = rects.get(ep.objectId);
    if (!r) return { x: ep.fallback.x, y: ep.fallback.y };
    const side = nearestSide(r, other);
    return sideAnchor(r, side);
  };

  // We need both endpoints, but each depends on the other. Use a two-pass
  // approach: first estimate using fallbacks/stored positions, then refine.
  const fromEstimate =
    c.from.kind === 'free'
      ? { x: c.from.x, y: c.from.y }
      : c.from.fallback;
  const toEstimate =
    c.to.kind === 'free'
      ? { x: c.to.x, y: c.to.y }
      : c.to.fallback;

  const from = resolve(c.from, toEstimate);
  const to = resolve(c.to, fromEstimate);

  return { from, to };
}

/**
 * The bounding box of a connector line from `from` to `to`.
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
