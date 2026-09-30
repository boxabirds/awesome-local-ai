import type { Rect, Point } from '@shared/geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Returns the midpoint of the given side of the rect.
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top': return { x: r.x + r.width / 2, y: r.y };
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left': return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * Returns which side of `r` is nearest to `toward`.
 * Uses the angle from the center of the rect to `toward`:
 * - right: angle in (-45, 45)
 * - top: angle in (45, 135)
 * - left: angle in (135, 180] or (-180, -135)
 * - bottom: angle in (-135, -45)
 * At exactly 45 degrees, switches to the side the object is transitioning to.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Use the ratio to determine which pair of sides is closer.
  // Compare |dx| / (width/2) vs |dy| / (height/2) to account for aspect ratio.
  const hw = r.width / 2 || 1;
  const hh = r.height / 2 || 1;

  const absDx = Math.abs(dx) / hw;
  const absDy = Math.abs(dy) / hh;

  if (absDx >= absDy) {
    // Closer to left or right
    return dx >= 0 ? 'right' : 'left';
  } else {
    // Closer to top or bottom
    return dy >= 0 ? 'bottom' : 'top';
  }
}

export interface ConnectorEndpoints {
  from: Point;
  to: Point;
}

/**
 * Resolve the world-space start and end points of a connector,
 * given the current rects of all objects on the board.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): ConnectorEndpoints {
  const fromPt = resolveEndpointPos(c.from, c.to, rects);
  const toPt = resolveEndpointPos(c.to, c.from, rects);
  return { from: fromPt, to: toPt };
}

type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

function resolveEndpointPos(
  ep: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };

  const rect = rects.get(ep.objectId);
  if (!rect) return ep.fallback; // orphaned: target missing

  // Get the position of the other end to determine nearest side
  const otherPt = resolveEndpointPosSimple(other, rects);
  const side = nearestSide(rect, otherPt);
  return sideAnchor(rect, side);
}

function resolveEndpointPosSimple(
  ep: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (!rect) return ep.fallback;
  // Return center for use as "toward" reference
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Compute the bounding box for a connector given its two resolved endpoints.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
}
