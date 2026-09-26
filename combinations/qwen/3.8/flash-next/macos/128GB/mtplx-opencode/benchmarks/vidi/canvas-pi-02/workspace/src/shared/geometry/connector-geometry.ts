/**
 * Connector geometry: side anchors, nearest-side detection, endpoint
 * resolution and bounding-box computation for arrows.
 *
 * All coordinates are world units.
 */
import type { Rect, Point } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The midpoint of a rect's given side. */
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
 * Determine which side of `r` is nearest to `toward`.
 *
 * Compares the direction vector from the rect's centre against the rect's
 * diagonals. For a square this reduces to the familiar 45° division; for
 * wider/taller rects the boundary tilts accordingly.
 *
 * The "diagonal boundary" between e.g. right and top is the line from the
 * centre to the top-right corner, whose slope is h/w. A point whose |dy/dx|
 * exceeds h/w lies in the top/bottom region; otherwise right/left.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Use the "normalised" comparison: |dx| * h >= |dy| * w means horizontal.
  // This avoids dividing by w or h which might be zero.
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx * r.height >= absDy * r.width) {
    // Horizontal-dominant: choose left or right.
    return dx >= 0 ? 'right' : 'left';
  } else {
    // Vertical-dominant: choose top or bottom.
    return dy >= 0 ? 'bottom' : 'top';
  }
}

/** Endpoint representation in the document. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Connector snapshot shape (matches snapshot output). */
export interface ConnectorSnap {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  from: Endpoint;
  to: Endpoint;
}

/**
 * Resolve a connector's actual start and end world-space points from its
 * endpoints and the current rects of all objects on the board.
 *
 * If an attached target is missing from `rects` (deleted), the stored
 * `fallback` point is used.
 */
export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  // Determine approximate centre/point of each end for direction computation.
  const fromPoint = resolvePoint(c.from, rects);
  const toPoint = resolvePoint(c.to, rects);

  // Resolve from: pick the side of from-object's rect nearest to toPoint.
  const from = resolveEnd(c.from, rects, toPoint);
  // Resolve to: pick the side of to-object's rect nearest to fromPoint.
  const to = resolveEnd(c.to, rects, fromPoint);

  return { from, to };
}

function resolvePoint(
  end: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect) return end.fallback;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function resolveEnd(
  end: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  toward: Point,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect) return end.fallback;
  const side = nearestSide(rect, toward);
  return sideAnchor(rect, side);
}

/**
 * Compute the axis-aligned bounding box enclosing two points.
 * Used to derive a connector's x/y/width/height in the snapshot.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
}
