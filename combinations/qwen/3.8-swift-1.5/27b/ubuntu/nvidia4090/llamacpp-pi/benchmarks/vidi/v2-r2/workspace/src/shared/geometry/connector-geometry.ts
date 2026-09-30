/**
 * Pure geometry for connector side anchors, nearest-side selection,
 * endpoint resolution and bounding box (story 10).
 */
import type { Rect, Point } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The midpoint of a rectangle's side. For diamonds and ellipses this is
 * also on the boundary.
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
 * Which side of rect `r` is nearest to point `toward`.
 *
 * The diagonal rule: the direction from the rect centre to `toward` is
 * compared against the rect's half-dimensions. If |dx| > |dy| * (w/h)
 * the nearest side is left/right; otherwise top/bottom.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Use the ratio of half-dimensions to determine the 45° diagonal in
  // rect-normalised space.
  const hw = r.width / 2;
  const hh = r.height / 2;

  if (hw === 0 && hh === 0) return 'right';
  if (hw === 0) return dy >= 0 ? 'bottom' : 'top';
  if (hh === 0) return dx >= 0 ? 'right' : 'left';

  // Compare |dx|/hw vs |dy|/hh: if the horizontal component dominates
  // (relative to the rect's proportions), the nearest side is left/right.
  if (Math.abs(dx) / hw > Math.abs(dy) / hh) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

export interface ConnectorEndpointSnap {
  kind: 'attached' | 'free';
  objectId?: string;
  fallback?: Point;
  x?: number;
  y?: number;
}

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  from: ConnectorEndpointSnap;
  to: ConnectorEndpointSnap;
}

/**
 * Resolves both endpoints of a connector to world-space points using the
 * current object rectangles. Attached ends are placed at the midpoint of
 * the nearest side; missing targets fall back to their stored point.
 */
export function resolveEndpoints(
  c: { from: ConnectorEndpointSnap; to: ConnectorEndpointSnap },
  rects: ReadonlyMap<string, Rect>
): { from: Point; to: Point } {
  const resolve = (ep: ConnectorEndpointSnap, other: Point): Point => {
    if (ep.kind === 'free') {
      return { x: ep.x!, y: ep.y! };
    }
    const rect = rects.get(ep.objectId!);
    if (!rect) {
      return ep.fallback ?? { x: 0, y: 0 };
    }
    const side = nearestSide(rect, other);
    return sideAnchor(rect, side);
  };

  // We need both endpoints, but each depends on the other.
  // Use an iterative approach: first pass uses fallbacks, second refines.
  const toInitial = c.to.kind === 'free'
    ? { x: c.to.x!, y: c.to.y! }
    : c.to.fallback ?? { x: 0, y: 0 };
  const fromInitial = c.from.kind === 'free'
    ? { x: c.from.x!, y: c.from.y! }
    : c.from.fallback ?? { x: 0, y: 0 };

  let from = resolve(c.from, toInitial);
  let to = resolve(c.to, from);
  // Second pass with refined other
  from = resolve(c.from, to);
  to = resolve(c.to, from);
  void fromInitial;

  return { from, to };
}

/**
 * Axis-aligned bounding box of a line segment from `a` to `b`.
 */
export function connectorBBox(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
