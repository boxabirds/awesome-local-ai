/**
 * Connector geometry (story 10).
 * Side anchors, nearest-side, endpoint resolution and bounding boxes.
 * All values in world units.
 */
import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Returns the midpoint of the given side of a rect.
 * For rect, ellipse and diamond, side midpoints lie on the boundary.
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':    return { x: r.x + r.width / 2, y: r.y };
    case 'right':  return { x: r.x + r.width,     y: r.y + r.height / 2 };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':   return { x: r.x,               y: r.y + r.height / 2 };
  }
}

/**
 * Returns which side of rect `r` is nearest to the external point `toward`.
 * Uses the angle from the rect centre to `toward` compared against diagonals.
 *
 * Convention: right=0°, top=90° (screen coords with y going down, so visually up).
 * The four diagonals are at 45°, 135°, 225°, 315°.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Use angle atan2(dy, dx) in radians
  // In screen coords: right=0, bottom=PI/2, left=±PI, top=-PI/2
  // We want: right for -45..45, bottom for 45..135, left for 135..180 and -180..-135, top for -135..-45
  const angle = Math.atan2(dy, dx); // -PI to PI

  // Convert to degrees for clarity
  // angle in (-45, 45] → right
  // angle in (45, 135] → bottom
  // angle in (-135, -45] → top
  // else → left
  const deg = angle * (180 / Math.PI);

  if (deg > -45 && deg <= 45) return 'right';
  if (deg > 45 && deg <= 135) return 'bottom';
  if (deg > -135 && deg <= -45) return 'top';
  return 'left';
}

/**
 * Connector snapshot interface for resolveEndpoints (forward-declared to avoid circular import).
 */
export type ConnectorEndpointLike =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * Resolve the actual world-space endpoints of a connector.
 * If an endpoint is attached and its object is present in `rects`, compute the side anchor.
 * If the object is missing (orphaned), use fallback.
 * If free, use stored x/y.
 */
export function resolveEndpoints(
  c: {
    from: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };
    to: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };
  },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = resolveOne(c.from, c.to, rects);
  const to = resolveOne(c.to, c.from, rects);
  return { from, to };
}

function resolveOne(
  end: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number },
  other: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number },
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };

  const r = rects.get(end.objectId);
  if (!r) return { x: end.fallback.x, y: end.fallback.y };

  // Resolve the "other" point to aim toward
  let otherPoint: Point;
  if (other.kind === 'free') {
    otherPoint = { x: other.x, y: other.y };
  } else {
    const otherRect = rects.get(other.objectId);
    if (otherRect) {
      otherPoint = { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
    } else {
      otherPoint = { x: other.fallback.x, y: other.fallback.y };
    }
  }

  const side = nearestSide(r, otherPoint);
  return sideAnchor(r, side);
}

/**
 * Compute the bounding box of a line segment from `from` to `to`.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
}
