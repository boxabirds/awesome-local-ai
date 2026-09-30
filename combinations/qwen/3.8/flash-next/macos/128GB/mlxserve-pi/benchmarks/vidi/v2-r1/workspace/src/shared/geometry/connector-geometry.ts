/**
 * Connector geometry (`connectors.geometry`).
 *
 * A connector is stored as two *ends*, not as two positions: an end is either
 * attached to an object (an id, plus a point to draw at while that object is
 * missing) or free (a point in board units). Everything about where an arrow is
 * drawn — which side of each shape it leaves from, where its two ends land, how big
 * a box it occupies — is derived from the objects it is attached to, which is what
 * makes the arrow follow a shape that moves. A copy that stored positions would sit
 * where it was drawn while the shape walked away from it.
 *
 * Nothing here touches the document, React or the DOM: the client resolves ends while
 * drawing, the model resolves them while detaching, and the same function does both.
 *
 * Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
 *       (connectors.geometry)
 */
import type { Point, Rect } from '../geometry';
import { isUsableRect } from '../geometry';
import { distance, unitDirection } from './polyline';

/** The four sides of a rectangle, named for where an arrow would leave it. */
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];

/** Which end of a connector a handle belongs to: the tail or the arrowhead. */
export const CONNECTOR_ENDS = ['from', 'to'] as const;
export type ConnectorEnd = (typeof CONNECTOR_ENDS)[number];

/**
 * One end of a connector, as it is stored.
 *
 * `attached` names an object and is resolved to a point on that object's boundary on
 * every read; `fallback` is the point it was attached at, kept so an arrow whose
 * object is gone is still drawn where it was drawn (state: *Orphaned*) instead of
 * disappearing or being moved somewhere nobody chose.
 */
export type Endpoint =
  | { readonly kind: 'attached'; readonly objectId: string; readonly fallback?: Point }
  | { readonly kind: 'free'; readonly x: number; readonly y: number };

/** A connector's two ends, as stored. */
export interface ConnectorEnds {
  readonly from: Endpoint;
  readonly to: Endpoint;
}

/** A resolved connector: two points, ready to draw. */
export interface ResolvedConnector {
  readonly from: Point;
  readonly to: Point;
}

const finite = (value: number): boolean => Number.isFinite(value);

const finitePoint = (p: Point | undefined): p is Point =>
  p !== undefined && finite(p.x) && finite(p.y);

/** True for a value that can be stored as an endpoint (and nothing else). */
export function isEndpoint(value: unknown): value is Endpoint {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as { kind?: unknown; objectId?: unknown; x?: unknown; y?: unknown };
  if (e.kind === 'free') return finite(e.x as number) && finite(e.y as number);
  if (e.kind === 'attached') return typeof e.objectId === 'string' && e.objectId !== '';
  return false;
}

/** The stored fallback point of an endpoint, if it has a usable one. */
export const endpointFallback = (e: Endpoint): Point | null =>
  e.kind === 'free' ? { x: e.x, y: e.y } : finitePoint(e.fallback) ? { ...e.fallback } : null;

/**
 * The point on `side` of `rect`: the midpoint of that edge, which lies on the
 * boundary of a rectangle, an ellipse and a diamond drawn inside it — the three
 * kinds a shape can be.
 */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

/**
 * The side of `rect` that faces `point`, chosen by the direction the point lies in
 * from the rectangle's centre: the diagonals of the rectangle divide the space into
 * four wedges, and the side is whichever the direction falls into.
 *
 * This is the rule that makes an arrow leave a shape on the side facing the other
 * end, and switch sides at the diagonal when a shape is dragged around a corner
 * (`connector.anchor_rule`) — a rule based on edge distance instead of direction
 * would switch sides too late on a wide shape and too early on a tall one.
 */
export function nearestSide(rect: Rect, point: Point): Side {
  if (!isUsableRect(rect) || !finitePoint(point)) return 'right';
  const dx = point.x - (rect.x + rect.width / 2);
  const dy = point.y - (rect.y + rect.height / 2);
  // The direction decides the side, and the 45° diagonals of the direction are the
  // boundaries: an arrow leaving to the right of centre uses a left or right side,
  // one leaving above centre uses a top or bottom one. Judging the direction rather
  // than the rectangle's own diagonals keeps a side from flipping midway through a
  // resize that happens to make the shape square for one frame.
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Where an endpoint is, given the rectangles of the objects on the board.
 *
 * An attached end whose object is gone (or has no usable box) is drawn at its
 * fallback point — an arrow outlives its shapes, and an arrow with nowhere to go is
 * an arrow that stays where it was. A free end is stored as a point.
 */
export function endpointPoint(endpoint: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
  const rect = rects.get(endpoint.objectId);
  if (!rect || !isUsableRect(rect)) {
    return endpointFallback(endpoint) ?? { x: 0, y: 0 };
  }
  // Only the end itself is known here, so it faces the point it was attached at, or
  // the middle of the shape it is attached to. `resolveEndpoints` is the function
  // that knows both ends, and is the one that aims an arrow.
  const facing = endpointFallback(endpoint) ?? {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
  return sideAnchor(rect, nearestSide(rect, facing));
}

/**
 * Both ends of a connector, as points, from the current rectangles of the objects it
 * is attached to (`connector.follow`).
 *
 * Each attached end anchors on the side of *its* shape that faces the *other* end, so
 * the two ends are mutually resolved: an end is first aimed at the other shape's
 * centre, and then the other end — which is a point on that shape — is used to pick
 * the side. Two shapes side by side therefore get a straight horizontal arrow between
 * their facing edges, and dragging one of them past a diagonal flips the arrow to the
 * new pair of sides in the same frame.
 *
 * An end whose object is missing falls back to its stored point, and a connector with
 * no usable ends at all resolves to two zeros rather than throwing.
 */
export function resolveEndpoints(
  connector: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): ResolvedConnector {
  const provisional = (endpoint: Endpoint): Point => {
    if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
    const rect = rects.get(endpoint.objectId);
    if (!rect || !isUsableRect(rect)) return endpointFallback(endpoint) ?? { x: 0, y: 0 };
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const resolve = (endpoint: Endpoint, other: Point): Point => {
    if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
    const rect = rects.get(endpoint.objectId);
    if (!rect || !isUsableRect(rect)) return endpointFallback(endpoint) ?? { x: 0, y: 0 };
    return sideAnchor(rect, nearestSide(rect, other));
  };
  // Pass one: where the tail would be if it faced the head's whole shape. Pass two:
  // where the head is, facing the point the tail actually landed on, so a bend the
  // first end introduces is answered by the second.
  const fromPoint = resolve(connector.from, provisional(connector.to));
  return { from: fromPoint, to: resolve(connector.to, fromPoint) };
}

/**
 * The point `amount` short of `to` on the way from `from` — where an arrow's shaft
 * stops so its head can end on the anchor. A segment shorter than the head itself
 * collapses to its own middle rather than pointing backwards.
 */
export function shortenSegment(from: Point, to: Point, amount: number): Point {
  if (!finitePoint(from) || !finitePoint(to)) return finitePoint(to) ? { ...to } : { x: 0, y: 0 };
  const back = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const length = distance(from, to);
  if (length === 0) return { ...to };
  if (length <= back) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const unit = unitDirection(from, to);
  return { x: to.x - unit.x * back, y: to.y - unit.y * back };
}

/**
 * The box a connector drawn between two points occupies — what its selection box is
 * drawn from, what the marquee compares against and what the undo of a connector is
 * found by. A perfectly horizontal or vertical arrow is a line, and a line is not a
 * rectangle, so the axis with nothing in it is given the arrow's own thickness: the
 * box is the arrow with its stroke around it, never empty.
 */
export function connectorBBox(from: Point, to: Point, thickness = 0): Rect {
  const t = Number.isFinite(thickness) && thickness > 0 ? thickness : 0;
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x: x - (from.x === to.x ? t / 2 : 0),
    y: y - (from.y === to.y ? t / 2 : 0),
    width: Math.abs(to.x - from.x) + (from.x === to.x ? t : 0),
    height: Math.abs(to.y - from.y) + (from.y === to.y ? t : 0),
  };
}

/** The two endpoints of a connector, as a map of id-less points (for hit tests). */
export const connectorPoints = (ends: ResolvedConnector): readonly Point[] => [
  ends.from,
  ends.to,
];

/**
 * The rectangle of an object as a plain rect, from anything that has x/y/width/
 * height. Kept here because the client builds `rects` maps out of object snapshots
 * and the model builds them out of document rows, and both need the same four fields
 * checked before they are trusted.
 */
export function rectOf(value: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Rect | null {
  const rect = { x: value.x, y: value.y, width: value.width, height: value.height };
  return isUsableRect(rect) ? rect : null;
}

/** A map of id → rect from anything with a box, skipping the objects without one. */
export function rectsOf(
  entries: Iterable<readonly [string, { x: number; y: number; width: number; height: number }]>,
): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, value] of entries) {
    const rect = rectOf(value);
    if (rect) rects.set(id, rect);
  }
  return rects;
}
