// Where an arrow starts and ends (story 10).
//
// An arrow never stores a picture of itself: it stores which two objects it joins
// (or two free points), and its geometry is *derived* from the objects it is
// attached to. That is what makes it follow them when they move — every client
// recomputes the same anchors from the same shapes, so nobody has to write the new
// coordinates anywhere (connector.follows, TC-07).
//
// This module is the whole rulebook: the side an arrow uses, the exact point on
// that side, and the box the arrow occupies. Pure world-unit geometry — no Yjs, no
// DOM — so every case is testable with numbers.

import { CONNECTOR_SIDES } from '../config';
import { normalizeRect, type Point, type Rect } from './geometry';

/**
 * One end of an arrow: either joined to an object (with the point to draw to when
 * that object is gone — its last known anchor), or free at a point in space.
 * (connector.no_accidental keeps free ends out of the way of moving objects.)
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The four sides of an object's box an arrow can attach to. */
export type Side = (typeof CONNECTOR_SIDES)[number];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(p: Point | undefined | null): p is Point {
  return !!p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

/** The middle of a box. Infinity-free: a broken box has no centre. */
export function centerOf(r: Rect): Point {
  if (!isFiniteRect(r)) return { x: 0, y: 0 };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function isFiniteRect(r: Rect | undefined | null): r is Rect {
  return (
    !!r &&
    isFiniteNumber(r.x) &&
    isFiniteNumber(r.y) &&
    isFiniteNumber(r.width) &&
    isFiniteNumber(r.height)
  );
}

/** Is this endpoint well-formed? (A remote peer can write anything.) */
export function isEndpoint(end: unknown): end is Endpoint {
  if (!end || typeof end !== 'object') return false;
  const e = end as { kind?: unknown; objectId?: unknown; x?: unknown; y?: unknown; fallback?: unknown };
  if (e.kind === 'free') return isFiniteNumber(e.x) && isFiniteNumber(e.y);
  if (e.kind === 'attached') {
    return (
    typeof e.objectId === 'string' &&
    e.objectId !== '' &&
    isFinitePoint(e.fallback as Point | null | undefined)
  );
  }
  return false;
}

/**
 * The point at the middle of one side of a box. (TC-10 asks for these exactly:
 * the midpoint of each of an object's four sides.)
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
    default:
      return { x: r.x, y: r.y + r.height / 2 };
  }
}

/** The four side anchors of a box, in CONNECTOR_SIDES order. */
export function sideAnchors(r: Rect): Record<Side, Point> {
  return {
    top: sideAnchor(r, 'top'),
    right: sideAnchor(r, 'right'),
    bottom: sideAnchor(r, 'bottom'),
    left: sideAnchor(r, 'left'),
  };
}

/**
 * The side of `r` that faces `toward`.
 *
 * The direction from the box's centre to the point is compared with the box's two
 * diagonals: whichever pair of opposite sides the direction falls between is the side
 * the arrow uses. That switches exactly at the diagonals — for a square, at 45°, so an
 * arrow moving from due east to due north of a box changes its side halfway between
 * the two (TC-10) — and it needs no distance, no square root and no tie that depends
 * on the box's size. A point exactly on a diagonal, or exactly at the centre, takes
 * the horizontal side, so two clients that compute this independently always agree
 * without talking to each other.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  if (!isFiniteRect(r) || !isFinitePoint(toward)) return 'right';
  const center = centerOf(r);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const width = Math.abs(r.width);
  const height = Math.abs(r.height);
  // |dx| / width vs |dy| / height, cross-multiplied to avoid dividing by a size that
  // may be 0: horizontal wins ties.
  if (Math.abs(dx) * height >= Math.abs(dy) * width) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

/**
 * Where an endpoint draws: the anchor of the side of its object that faces
 * `toward`; a free endpoint draws at its own point; an endpoint whose object is
 * gone draws at its fallback — the last place it was. (connector.detaches, TC-11.)
 */
export function endpointAnchor(
  end: Endpoint,
  toward: Point,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!isFiniteRect(rect)) return end.fallback;
  return sideAnchor(rect, nearestSide(rect, toward));
}

/** Which side an attached endpoint currently uses, or null when it does not. */
export function endpointSide(
  end: Endpoint,
  toward: Point,
  rects: ReadonlyMap<string, Rect>,
): Side | null {
  if (end.kind !== 'attached') return null;
  const rect = rects.get(end.objectId);
  if (!isFiniteRect(rect)) return null;
  return nearestSide(rect, toward);
}

/**
 * What the *other* end pulls an end towards: the centre of the object the other end
 * is attached to, or the other end's own point. Using the other object's centre
 * (rather than the other end's anchor) is what keeps a pair of ends stable while a
 * shape moves.
 */
export function endToward(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!isFiniteRect(rect)) return end.fallback;
  return centerOf(rect);
}

/** The two endpoints of an arrow, in any of the shapes they travel in. */
export interface ConnectorEnds {
  from: Endpoint;
  to: Endpoint;
}

/**
 * Both ends of an arrow, resolved against the objects they are attached to. The
 * renderer and the model call the same function, so the arrow a test measures is
 * the arrow a person sees. (connector.follows, connector.side.)
 */
export function resolveEndpoints(
  ends: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: endpointAnchor(ends.from, endToward(ends.to, rects), rects),
    to: endpointAnchor(ends.to, endToward(ends.from, rects), rects),
  };
}

/**
 * The box an arrow occupies: the bounds of its two drawn points. An arrow owns no
 * position of its own (it stores 0/0/0/0), so this is what its snapshot reports and
 * what puts its selection around it. (TC-29.)
 */
export function connectorBBox(from: Point, to: Point): Rect {
  if (!isFinitePoint(from) || !isFinitePoint(to)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return normalizeRect(from, to);
}

/** The two drawn points of an arrow, as a polyline (for the distance hit-test). */
export function endpointPolyline(ends: {
  from: Point;
  to: Point;
}): [Point, Point] {
  return [ends.from, ends.to];
}

/**
 * The path an arrow draws, as a polyline: its two resolved points. Today an arrow is one
 * straight segment; if it ever bends, this is the one function that says where. Callers
 * hand it the snapshot's `endpoints`, which is the same derived pair the renderer paints
 * and the model measures (connector.follows, connector.select).
 */
export function connectorPolyline(line: { from: Point; to: Point }): Point[] {
  if (!isFinitePoint(line.from) || !isFinitePoint(line.to)) return [];
  return [line.from, line.to];
}
