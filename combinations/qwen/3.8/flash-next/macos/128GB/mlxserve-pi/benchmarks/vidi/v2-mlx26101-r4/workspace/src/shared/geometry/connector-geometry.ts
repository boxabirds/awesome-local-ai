/**
 * Where an arrow's ends go, and what happens to them when the things they point at move.
 *
 * This file is the whole of what "the arrow follows the shape" means. It knows no document and performs no
 * writes: it is given an arrow's two ends and the current rectangles of the objects on the board, and it
 * answers with two points. That is why a move by a colleague redraws an arrow on every screen without any
 * code having to notice it — the arrow was never storing a place of its own, so there was nothing to update.
 * An arrow that stored its own endpoints would need five clients to agree about a recomputation, and the
 * first thing that goes wrong in a board that stores derived numbers is that they disagree.
 *
 * **The anchor is the midpoint of a side, and that one point does three jobs**: it is where the arrow is
 * drawn, it is where the four connection dots are drawn, and it is the point saved as the end's `fallback` —
 * the place the arrow goes back to when the object at it is deleted (connector.target_deleted), because
 * "the arrow stays where the object's side was" has to name a point, and this is the point the arrow was
 * using a moment before.
 *
 * **The side is chosen by the diagonals, not by the distance.** Which side of a box a second object is on is
 * decided by which wedge of the box's two diagonals the other end falls in: left and right if it is more to
 * the side than above or below, top and bottom otherwise. For a square box the switch is at exactly 45°, so
 * an object that orbits the corner of another one sees the arrow jump from the right side to the top without
 * either object being nudged — which is what "the side nearest the other end" means when there is no single
 * nearest point on the outline.
 *
 * **The midpoint of a side is on the boundary of all three shapes.** It is on a rectangle's edge by
 * definition; it is where an ellipse drawn inside the box touches it; and it is a vertex of a diamond, which
 * is drawn as the polygon through the four midpoints. One anchor rule for three kinds of shape is why an
 * arrow looks attached to a shape whatever its kind, and why a shape can change its size without an arrow
 * having to know what it is.
 */
import type { Point, Rect } from '../geometry';

/** The four sides of a box, in the order the connection dots are drawn in. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = Object.freeze(['top', 'right', 'bottom', 'left'] as const);

/**
 * One end of an arrow.
 *
 * An end is either **attached** to an object — which is a promise to follow that object around, and carries
 * the `fallback` point where it is drawn if the object stops existing — or **free**, pinned to a board point
 * nobody owns. Both kinds always carry a usable point: `fallback` for an attached end, its own `x`/`y` for a
 * free one. That is what lets the board draw every arrow it has ever stored, including one whose object was
 * deleted by somebody else in a tab half the world away, without a special case for "an arrow with nowhere
 * to go".
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The two ends of an arrow. `ConnectorSnap` has this shape, so it can be passed straight in. */
export interface ConnectorEnds {
  from: Endpoint;
  to: Endpoint;
}

/** The two points an arrow is drawn between. */
export interface ResolvedEnds {
  from: Point;
  to: Point;
}

/** A free end at this board point. */
export function freeEndpoint(at: Point): Endpoint {
  return { kind: 'free', x: at.x, y: at.y };
}

/** An end attached to an object, with the point it falls back to when that object is gone. */
export function attachedEndpoint(objectId: string, fallback: Point): Endpoint {
  return { kind: 'attached', objectId, fallback: { x: fallback.x, y: fallback.y } };
}

/**
 * Whether a value is a well-formed **stored** end.
 *
 * This is the shape the document is allowed to contain, and it is deliberately narrower than what a caller
 * may hand to `createConnector`: a plain point is a thing somebody means as an end and is turned into one on
 * the way in (`endOf`), but it is not a record of an end — it does not say whether the end belongs to an
 * object, which is the one thing an arrow has to remember in order to follow anything.
 */
export function isEndpoint(value: unknown): value is Endpoint {
  if (typeof value !== 'object' || value === null) return false;
  const end = value as Partial<Endpoint> & { x?: unknown; y?: unknown };
  if (end.kind === 'free') return finite(end.x) && finite(end.y);
  if (end.kind === 'attached') {
    return typeof end.objectId === 'string' && end.objectId !== '' && isPoint(end.fallback);
  }
  return false;
}

/**
 * Read anything as an end, which is what the callers that are not the model need.
 *
 * A plain point is an end attached to nothing: that is what a point released over empty board *means*, and it
 * is the form `createConnector` is documented to take. Anything that is neither is answered with an end at
 * the origin rather than an exception — this is called while drawing, from a snapshot somebody else wrote, an
 * arrow that cannot be drawn at all helps nobody more than an arrow drawn in the wrong corner does not.
 */
export function endOf(value: unknown): Endpoint {
  if (isPoint(value)) return freeEndpoint({ x: value.x, y: value.y });
  return isEndpoint(value) ? value : freeEndpoint({ x: 0, y: 0 });
}

/**
 * The point an end is drawn at, on its own terms and without looking at anything else.
 *
 * A free end is drawn where it is pinned; an attached end is drawn on the side of its object that faces the
 * other end, which this function cannot know — so it answers with the `fallback`, the point the end was drawn
 * at the last time its object was seen. That is the whole worth of a fallback: it is what an end has to say
 * about its position when the object it belongs to is not on the table.
 */
export function endPosition(end: Endpoint): Point {
  return end.kind === 'free' ? { x: end.x, y: end.y } : { x: end.fallback.x, y: end.fallback.y };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    finite((value as Point).x) &&
    finite((value as Point).y)
  );
}

function isRect(value: unknown): value is Rect {
  return (
    typeof value === 'object' &&
    value !== null &&
    finite((value as Rect).x) &&
    finite((value as Rect).y) &&
    finite((value as Rect).width) &&
    finite((value as Rect).height)
  );
}

/**
 * The point on a box's side that an arrow ends at: the midpoint of that side.
 *
 * Reads the box it is given rather than a copy, so an object that has just been resized gives a point on its
 * *new* side without anything having to be recomputed or written down (connector.follow).
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
    default:
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

/**
 * Which side of `rect` the point `toward` is on.
 *
 * The direction from the box's centre to the point is compared with the box's diagonals: the point is on the
 * left or right side when it is further to one side than it is above or below, measured in the box's own
 * proportions (`|dy| * width` against `|dx| * height`), and on the top or bottom side when it is not.
 *
 * A square box therefore switches at exactly 45°, and a wide box switches earlier than that, which is the
 * point: a wide box has more left and right side to attach to, so an object almost directly above it but a
 * little to one side is closer to the middle of that big left or right side than to the short top edge.
 *
 * A point exactly on a diagonal counts as left/right, and a point at the exact centre counts as right — the
 * tie has to be broken somewhere, and it is broken towards the horizontal because a drag that starts and
 * ends on the same pixel is going to be thrown away for being too short anyway.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const dx = toward.x - (rect.x + rect.width / 2);
  const dy = toward.y - (rect.y + rect.height / 2);
  if (Math.abs(dy) * Math.abs(rect.width) < Math.abs(dx) * Math.abs(rect.height)) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

/**
 * Where an end is drawn right now: a free end at its own point; an attached end at the middle of the side of
 * its object that faces `other`.
 *
 * An attached end whose object is not on the board falls back to the point stored with it. That is not a stale
 * answer being repeated, it is the only answer there is: the stored point is where the arrow was attached, and
 * it is what a screen can draw when it has not received the shape yet, or has already received its deletion.
 */
function anchorOf(end: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  // Looked up rather than type-checked: a `ReadonlyMap` is a `Map` in this realm but not necessarily one
  // `instanceof` recognises, and a box that was not found because of a prototype is a box that would quietly
  // stop being followed.
  const rect = typeof rects?.get === 'function' ? rects.get(end.objectId) : undefined;
  // The object is not there — deleted by somebody else, or not yet arrived from the room. The stored point
  // is not a stale answer, it is the only answer: it is where the arrow was attached (connector.target_deleted
  // and the error path "target object missing at resolve time").
  if (!isRect(rect)) return { x: end.fallback.x, y: end.fallback.y };
  return sideAnchor(rect, nearestSide(rect, other));
}

/**
 * The two points to draw an arrow between, given the objects on the board right now.
 *
 * Called on every snapshot, which is the entire mechanism of "the arrow follows the shape": nobody updates
 * the arrow, the arrow is recomputed from wherever its objects currently are. Resizing counts as moving, and
 * so does a change made by a colleague, because this reads the same snapshots everybody else draws from.
 *
 * The two ends are resolved against each other, which is why each end is *seeded* first: the side of A that
 * is nearest B depends on where B is, and where B is drawn depends on which side of A is chosen. The seed is
 * the other end's object **centre as it is now** — not the point stored in this arrow, which is a record of
 * where the arrow was attached and can be years out of date — and one pass settles it, the same way on every
 * screen, because the centres it reads are in the document. An end whose object is missing falls back to its
 * stored point, and the other end is then computed towards that fallback rather than towards nothing (no
 * throw, no arrow swallowed).
 *
 * The ends are taken as `Partial`, and a plain point among them is read as a free end, because the two things
 * that call this are not the same kind of caller: the model hands over ends it has just checked, and a
 * painter hands over whatever its snapshot happens to carry — which for a snapshot of a healthy arrow is
 * already two resolved points, and for a snapshot from an older build may be nothing at all. A reader that
 * insisted on the stored form would answer "there is no arrow" to a question about an arrow that is plainly
 * on the screen; this answers with the least bad position available and lets the caller's own checks decide
 * whether the object is real.
 */
export function resolveEndpoints(
  connector: Partial<ConnectorEnds>,
  rects: ReadonlyMap<string, Rect>,
): ResolvedEnds {
  const from = endOf(connector?.from);
  const to = endOf(connector?.to);

  const seedFrom = seedOf(from, rects);
  const seedTo = seedOf(to, rects);
  return {
    from: anchorOf(from, seedTo, rects),
    to: anchorOf(to, seedFrom, rects),
  };
}

/**
 * Where an end is going to be drawn, before the object at the other end has had its say.
 *
 * The centre of the object it is attached to, because that is the one point about an object that does not
 * depend on which side of it gets chosen — and unlike the point stored in the arrow, which remembers where
 * the arrow was attached and remembers it even after the object has been dragged somewhere else, it is never
 * out of date.
 */
function seedOf(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = typeof rects?.get === 'function' ? rects.get(end.objectId) : undefined;
  if (!isRect(rect)) return { x: end.fallback.x, y: end.fallback.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The box an arrow drawn between two points occupies.
 *
 * It is the box of the straight line, which is as wide and as tall as the two ends are apart — so a perfectly
 * horizontal arrow has no height at all, and that is honest: it does not cover any of the board between two
 * points that share a row. Selection, marquee and the undo of a move all read this box, which is the reason
 * it is computed here rather than stored: the marquee's rule is "entirely inside", and an arrow whose stored
 * box had drifted a pixel from the line it is drawn on would be selected by a box that never touched it.
 *
 * A box with no width or no height is a real box for these purposes; nothing in the board resizes an arrow by
 * its box (arrows have no resize handles), and a hit test on an arrow asks a distance question, not a box
 * one.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * The three corners of an arrowhead at `to`, pointing away from `from`.
 *
 * Points and not a path, and the size handed in rather than read from the settings, because the same answer
 * is needed twice at two different scales: an arrow that is on the board is drawn in board units and grows
 * with the board, while a preview of an arrow being drawn is drawn in screen units and does not. Both are the
 * same triangle, and a triangle invented twice is two triangles that will drift apart the first time one of
 * them is changed.
 *
 * An arrow of no length has no direction, and so no head: the empty list rather than a triangle of `NaN`s,
 * which an SVG would draw as nothing while hiding the reason.
 */
export function arrowheadPoints(from: Point, to: Point, size: number): readonly Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !(size > 0)) return [];
  const ux = dx / length;
  const uy = dy / length;
  const back = { x: to.x - ux * size, y: to.y - uy * size };
  const half = size * 0.45;
  return [to, { x: back.x - uy * half, y: back.y + ux * half }, { x: back.x + uy * half, y: back.y - ux * half }];
}

/** The same three corners, as an SVG `points` attribute. */
export function arrowheadAttribute(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

/**
 * Where an arrow's line stops, so that its head sits at the end of it instead of lying on top of the last
 * inch of it.
 *
 * An arrow shorter than its own head has no line left to draw, and comes back at the far end: the head is
 * then the whole of the arrow, which is what a very short arrow looks like.
 */
export function arrowLineEnd(from: Point, to: Point, headSize: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > headSize)) return { x: from.x, y: from.y };
  const shorten = length - headSize / 2;
  return { x: from.x + (dx / length) * shorten, y: from.y + (dy / length) * shorten };
}
