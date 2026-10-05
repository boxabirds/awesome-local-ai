/**
 * Connector geometry (story 10).
 *
 * Pure functions that turn a connector's stored ends into the two points the
 * arrow is drawn between. They never write to the document and never read a Yjs
 * type: the caller passes in the live rectangle of every object on the board,
 * which is why an arrow follows a shape being dragged — the rectangles change,
 * and these functions are called again.
 */
import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

/** The four sides of an object. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The four sides, in the order a screen reader should meet them. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The two ends of a connector, in order. */
export const ENDS = ['from', 'to'] as const;

/** Anything that has two ends: a stored connector or its snapshot. */
export interface HasEnds {
  from: Endpoint;
  to: Endpoint;
}

/** Is this one of the four sides of an object? */
export function isSide(value: unknown): value is Side {
  return typeof value === 'string' && (SIDES as readonly string[]).includes(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The side of `rect` that faces `toward`.
 *
 * Comparing the offsets *relative to the side lengths* is what makes a wide shape
 * get a left/right connector when the other end is beside it, however far away,
 * instead of a top/bottom one — and it switches at the diagonal of the shape. A
 * point inside the rectangle still gets a definite answer, so overlapping objects
 * never leave an end undecided.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  if (!finite(rect?.x) || !finite(rect?.y) || !finite(toward?.x) || !finite(toward?.y)) {
    return 'right';
  }
  const dx = toward.x - (rect.x + rect.width / 2);
  const dy = toward.y - (rect.y + rect.height / 2);
  // A degenerate rectangle must not divide by zero; the offsets decide either way.
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  if (Math.abs(dx) / width >= Math.abs(dy) / height) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

/** The middle of `side`, in world units. */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
}

/** Where an end sits before its side is known: its object's centre, or its own point. */
function roughPoint(endpoint: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  const rect = rects.get(endpoint.objectId);
  // A missing object is not an error: the end stays where it was last drawn.
  if (!rect || !finite(rect.x) || !finite(rect.y)) {
    return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  }
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The point an end is drawn at: the middle of the side facing `toward`. */
function anchorOf(endpoint: Endpoint, rects: ReadonlyMap<string, Rect>, toward: Point): Point {
  if (endpoint.kind === 'free') {
    return { x: endpoint.x, y: endpoint.y };
  }
  const rect = rects.get(endpoint.objectId);
  if (!rect || !finite(rect.x) || !finite(rect.y)) {
    return { x: endpoint.fallback.x, y: endpoint.fallback.y };
  }
  return sideAnchor(rect, nearestSide(rect, toward));
}

/**
 * Where a connector's ends actually are, given the live rectangles.
 *
 * Two passes, because each end's side depends on where the other end is: the
 * first decides both sides from object centre to object centre, the second
 * re-decides each end from the *other* end's resolved point. That is enough to be
 * stable — a side only changes when the other object moves around this one, never
 * while it slides straight away from it.
 *
 * An end whose object is gone keeps its fallback point, so an arrow is always
 * drawn (see `Orphaned` in the design's state diagram).
 */
export function resolveEndpoints(
  connector: HasEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  // Pass one: object centre to object centre.
  const start = roughPoint(connector.from, rects);
  const end = roughPoint(connector.to, rects);
  const firstFrom = anchorOf(connector.from, rects, end);
  const firstTo = anchorOf(connector.to, rects, start);
  // Pass two: each end looks at where the other one actually landed.
  return {
    from: anchorOf(connector.from, rects, firstTo),
    to: anchorOf(connector.to, rects, firstFrom),
  };
}

/** The box two resolved ends cover — an arrow's selection frame and hit box. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Are both of these points usable? (A broken end leaves an arrow out of the snapshot.) */
export function isResolvable(points: { from: Point; to: Point }): boolean {
  return (
    finite(points.from?.x) &&
    finite(points.from?.y) &&
    finite(points.to?.x) &&
    finite(points.to?.y)
  );
}
