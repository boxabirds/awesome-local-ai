import type { Point, Rect } from '../geometry';
import type { ConnectorSnap, EndpointInput } from '../objects/connector';

/** The middle of a rectangle; the direction an attached end is judged from. */
function centerOf(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Where an arrow meets an object (story 10, `connector.follow`).
 *
 * An attached endpoint is never stored as a point: it is stored as the *object*
 * id, and the point is recomputed from that object's current rectangle on every
 * read. That is the whole reason arrows follow moved objects — a move by anybody
 * changes the rectangle, and the arrow is drawn from the new one (PRD
 * connector.follow).
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The four sides, clockwise from the top — the four dots a hover shows. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

function finite(n: number | undefined, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Midpoint of one side of a rectangle, in world units. */
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
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Which side of `r` faces `toward` (TC-10).
 *
 * The sides are divided by the rectangle's own diagonals: an object exactly on the
 * right of `r` leaves it on the right, and once the direction passes the corner
 * diagonal it leaves on the top instead. Comparing the offsets scaled by the side
 * lengths is that rule written without angles, so it holds for any aspect ratio.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = centerOf(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  // Degenerate rectangles still have four sides; a hair of slack avoids 0 ÷ 0.
  const w = Math.max(Math.abs(r.width), 1e-6);
  const h = Math.max(Math.abs(r.height), 1e-6);
  if (Math.abs(dx) / w > Math.abs(dy) / h) return dx >= 0 ? 'right' : 'left';
  if (dy > 0) return 'bottom';
  if (dy < 0) return 'top';
  // Dead level with the centre, and not further right or left either: pick a side.
  return 'top';
}

/** The point an endpoint is drawn at, given the rectangles that are on the board. */
function endpointPoint(
  end: EndpointInput,
  rects: ReadonlyMap<string, Rect>,
  toward: Point,
): Point {
  if (end.kind === 'free') return { x: finite(end.x), y: finite(end.y) };
  const r = rects.get(end.objectId);
  if (r) return sideAnchor(r, nearestSide(r, toward));
  // Orphaned (PRD connector.target_deleted): the point it was attached at.
  const f = end.fallback;
  if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) return { x: f.x, y: f.y };
  return { x: 0, y: 0 };
}

/**
 * Where the centre of an endpoint sits — used as the direction the *other* end is
 * judged against, so neither end needs the other's answer first.
 */
function endpointCentre(end: EndpointInput, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: finite(end.x), y: finite(end.y) };
  const r = rects.get(end.objectId);
  if (r) return centerOf(r);
  const f = end.fallback;
  return f && Number.isFinite(f.x) && Number.isFinite(f.y)
    ? { x: f.x, y: f.y }
    : { x: 0, y: 0 };
}

/**
 * Both ends of a connector as points, recomputed from the current rectangles
 * (`connector.follow`). Each attached end sits at the midpoint of the side of its
 * object nearest the other end; an end whose object is gone falls back to the point
 * stored when it was attached, so an arrow is always drawn.
 */
export function resolveEndpoints(
  c: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return resolveEndpointPair({ from: c.from, to: c.to }, rects);
}

/**
 * The same rule for a bare pair of ends, which is what the model has before a
 * connector exists (a create) or after one end changed (a re-attach).
 */
export function resolveEndpointPair(
  ends: { from: EndpointInput; to: EndpointInput },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromCentre = endpointCentre(ends.from, rects);
  const toCentre = endpointCentre(ends.to, rects);
  return {
    from: endpointPoint(ends.from, rects, toCentre),
    to: endpointPoint(ends.to, rects, fromCentre),
  };
}

/**
 * The box that covers both resolved points: what story 7's selection, marquee and
 * selection overlay use as the connector's bounds, and what the SVG is positioned by.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}
