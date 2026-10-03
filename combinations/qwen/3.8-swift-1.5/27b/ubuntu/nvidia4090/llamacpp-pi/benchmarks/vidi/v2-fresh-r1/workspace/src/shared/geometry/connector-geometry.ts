// Connector geometry: side anchors, nearest-side selection, endpoint resolution.
// Pure functions only — no Yjs, no React.

import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The midpoint of a rect's side (on the boundary).
 * For rect: the midpoint of the edge.
 * For ellipse: the point on the ellipse boundary at that side.
 * For diamond: the vertex at that side.
 * Since all three shapes are inscribed in the same rect, the side midpoints
 * are the same for all three kinds.
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
 * Determine which side of rect `r` is nearest to point `toward`.
 * The side is chosen by comparing the direction from the rect's centre to
 * `toward` with the 45° diagonals:
 * - If the direction is more horizontal than vertical → left or right
 * - If the direction is more vertical than horizontal → top or bottom
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Compare |dx| and |dy| to determine the dominant axis.
  // The 45° diagonal is the boundary: when |dx| === |dy|, either axis works.
  // We use >= so that exactly-on-diagonal picks the horizontal side.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/**
 * A connector endpoint as stored in the doc.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * A minimal connector snapshot for geometry purposes.
 */
export interface ConnectorSnap {
  id: string;
  from: Endpoint;
  to: Endpoint;
}

/**
 * Resolve both endpoints of a connector to world points.
 * - Attached endpoints: use `nearestSide` + `sideAnchor` on the target's rect.
 * - Free endpoints: use the stored x/y.
 * - Missing target (orphaned): use the stored `fallback` point.
 *
 * No writes — this is called every render, so remote moves redraw automatically.
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
  ep: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') {
    return { x: ep.x, y: ep.y };
  }
  // Attached: find the target rect
  const rect = rects.get(ep.objectId);
  if (!rect) {
    // Orphaned: target missing, use fallback
    return { x: ep.fallback.x, y: ep.fallback.y };
  }
  // Determine the point to aim toward: the other endpoint's resolved position.
  // We use the other endpoint's fallback or free point as the aim target.
  // This is a simplification: in practice both ends are resolved simultaneously,
  // but using the fallback/free point of the other end gives the correct side.
  const aim = other.kind === 'free'
    ? { x: other.x, y: other.y }
    : other.fallback;

  const side = nearestSide(rect, aim);
  return sideAnchor(rect, side);
}

/**
 * Bounding box of a connector line from `from` to `to`.
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
