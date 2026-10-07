export interface ConnectorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectorPoint {
  x: number;
  y: number;
}

export type Rect = ConnectorRect;
export type Point = ConnectorPoint;

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Endpoint stored on a connector object. */
export interface AttachedEndpoint {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

/** Free endpoint attached to board space. */
export interface FreeEndpoint {
  kind: 'free';
  x: number;
  y: number;
}

export type Endpoint = AttachedEndpoint | FreeEndpoint;

/** Connector snap for rendering — endpoints resolved by snapshot. */
export interface ConnectorSnap {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
  z: number;
  createdBy: string;
  createdAt: number;
}

/** Compute the anchor point at the midpoint of a side. */
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
 * Given a rectangle `r` and a target point `toward`, determine which side
 * of `r` is nearest to that point. Falls back to right when point is centered.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Compare angle with diagonals: atan(±hw/hw) = ±45°
  // When |dx| > |dy| → left or right
  // When |dy| > |dx| → top or bottom
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/**
 * Resolve connector endpoints to world-space points using current object rects.
 * For attached ends, computes the nearest side anchor from the target rect.
 * If the target is missing, falls back to the stored fallback point.
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  function resolve(ep: Endpoint): Point {
    if (ep.kind === 'free') {
      return { x: ep.x, y: ep.y };
    }
    const rect = rects.get(ep.objectId);
    if (rect) {
      return sideAnchor(rect, nearestSide(rect, ep.fallback));
    }
    // Orphaned — target missing, use fallback
    return { ...ep.fallback };
  }
  return { from: resolve(c.from), to: resolve(c.to) };
}

/** Compute bounding box of the line segment. */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  return { x, y, width: w, height: h };
}

/** Distance from point p to line segment ab. */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a == b) → distance to point
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  // Project p onto ab, clamped to [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/**
 * Distance from a point to a polyline (sequence of connected segments).
 * Returns the minimum distance to any segment.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i], pts[i + 1], p);
    if (d < minDist) minDist = d;
  }
  return minDist;
}
