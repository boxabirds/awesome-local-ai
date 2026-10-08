import type { Rect, Point } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Get the anchor point at the midpoint of a side of a rectangle. */
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
 * Compares the direction vector from center to `toward` against the diagonal.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Half width and height for comparison
  const hw = r.width / 2;
  const hh = r.height / 2;

  // At exactly the diagonal (45°), prefer horizontal/vertical consistently
  // The switch happens when |dy|/hh > |dx|/hw → vertical wins
  if (Math.abs(dy) * hw > Math.abs(dx) * hh + 1e-9) {
    // Vertical direction dominates
    return dy < 0 ? 'top' : 'bottom';
  } else {
    // Horizontal direction dominates or equal
    return dx < 0 ? 'left' : 'right';
  }
}

/** Resolve connector endpoints from current object rectangles. */
export function resolveEndpoints(
  c: { from: any; to: any },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromPoint = resolveEndpoint(c.from, rects);
  const toPoint = resolveEndpoint(c.to, rects);
  return { from: fromPoint, to: toPoint };
}

function resolveEndpoint(
  endpoint: any,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  if (endpoint.kind === 'attached') {
    const rect = rects.get(endpoint.objectId);
    if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    // Target missing → use fallback
    if (endpoint.fallback && isFinitePoint(endpoint.fallback)) {
      return { x: endpoint.fallback.x, y: endpoint.fallback.y };
    }
  }
  // Last resort: default origin
  return { x: 0, y: 0 };
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Compute bounding box for an arrow line from two endpoints. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Distance from point p to line segment (a, b). */
export function distanceToSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point
    const ddx = p.x - a.x;
    const ddy = p.y - a.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // Project p onto the line, clamped to [0,1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const pdx = p.x - projX;
  const pdy = p.y - projY;
  return Math.sqrt(pdx * pdx + pdy * pdy);
}

/** Distance from point p to a polyline defined by points. */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  let minDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const dist = distanceToSegment(pts[i], pts[i + 1], p);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}
