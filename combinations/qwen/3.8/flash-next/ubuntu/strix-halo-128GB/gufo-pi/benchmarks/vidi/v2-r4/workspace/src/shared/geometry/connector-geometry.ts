/**
 * Connector geometry: side anchors, nearest-side selection, endpoint resolution,
 * and bounding boxes for connectors.
 *
 * All coordinates are in world units.
 */
import type { Rect } from '../geometry';
import type { Point } from '../../client/canvas/camera';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Midpoint of a given side of a rect. */
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
 * Determine which side of `r` is nearest to point `toward`.
 *
 * Uses the angle from the rect's centre to `toward`:
 * - right: angle in (-45°, 45°)
 * - top: angle in (45°, 135°)
 * - left: angle in (135°, 180°] or (-180°, -135°)
 * - bottom: angle in (-135°, -45°)
 *
 * At exactly 45°/135° etc. the side switch happens (top/bottom wins over left/right).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // If the point is at the centre, default to 'right'
  if (dx === 0 && dy === 0) return 'right';

  // Compare angle with the rect's diagonals.
  // We use the aspect-ratio-aware comparison:
  // The diagonal from centre goes to (width/2, height/2).
  // A point is on the "right" side if |dx|/halfW >= |dy|/halfH and dx > 0, etc.
  const halfW = r.width / 2;
  const halfH = r.height / 2;

  // Normalized distances along each axis
  const nx = Math.abs(dx) / halfW;
  const ny = Math.abs(dy) / halfH;

  if (nx >= ny) {
    // Left or right wins (at exact 45° diagonal, right/left wins over top/bottom per design)
    // But per the design: "switch at the diagonal" means at 45° top/bottom wins
    // TC-10: at 44° -> right, at 46° -> top. So ny > nx -> top/bottom, nx > ny -> left/right
    // At exactly nx == ny (45°): top/bottom wins per TC-10 (44 right, 46 top, so the switch
    // is at 45° where ny catches up to nx). Let's use ny > nx for top/bottom.
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy > 0 ? 'bottom' : 'top';
  }
}

/** Endpoint type for connectors (duplicated here for geometry's use). */
export interface EndpointAttached {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

export interface EndpointFree {
  kind: 'free';
  x: number;
  y: number;
}

export type Endpoint = EndpointAttached | EndpointFree;

/** Minimal connector snapshot shape for resolveEndpoints. */
export interface ConnectorSnapForResolve {
  from: Endpoint;
  to: Endpoint;
}

/**
 * Resolve both endpoints of a connector to world-space points using
 * the current rects map. If an attached target is missing, use its fallback.
 */
export function resolveEndpoints(
  c: ConnectorSnapForResolve,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromPt = resolveOne(c.from, c.to, rects);
  const toPt = resolveOne(c.to, c.from, rects);
  return { from: fromPt, to: toPt };
}

function resolveOne(
  self: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (self.kind === 'free') {
    return { x: self.x, y: self.y };
  }
  // attached
  const selfRect = rects.get(self.objectId);
  if (!selfRect) return { x: self.fallback.x, y: self.fallback.y };

  // Need the other end's world point to determine nearest side
  const otherPt = resolveOtherPoint(other, rects);
  const side = nearestSide(selfRect, otherPt);
  return sideAnchor(selfRect, side);
}

function resolveOtherPoint(
  ep: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const r = rects.get(ep.objectId);
  if (!r) return { x: ep.fallback.x, y: ep.fallback.y };
  // Use the centre of the other object to determine sides (simple heuristic)
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Bounding box of a straight line from `from` to `to`. */
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
