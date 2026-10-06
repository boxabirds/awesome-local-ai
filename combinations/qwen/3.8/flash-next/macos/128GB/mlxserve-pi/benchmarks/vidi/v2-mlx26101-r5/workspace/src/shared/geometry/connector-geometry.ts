/**
 * Where an arrow is drawn, given the boxes it joins.
 *
 * This is the file that makes an arrow follow the things it points at, and it does it without being
 * told anything about movement. An attached end of an arrow stores *which object* it is on and nothing
 * about where; every time the board is read, the end's position is asked of the object's rectangle as it
 * is at that moment. So a stranger drags a shape half a world away, story 3 delivers the shape's new
 * numbers, this file recomputes the two ends of the arrow from them, and the arrow moves on every screen
 * in the building without one byte about the arrow having been written. That is also why the functions
 * here take a map of rectangles instead of a document: the board already knows where everything is by
 * the time it asks, and this has to be able to answer without going to find out for itself.
 *
 * Nothing in here writes, imports Yjs or knows what a transaction is. It is four pure functions about
 * boxes, which is why the whole of TC-10 and TC-11 is testable without a document in sight.
 */

import type { Point, Rect } from '../geometry';
import type { Endpoint } from '../objects/connector';

/**
 * Which side of a box an arrow end sits on.
 *
 * Named for the sides of the world rather than the letters of a compass because the names are read by
 * whoever draws the four dots around a hovered object, and a dot on the `n` side of a box is a small
 * puzzle in a file that has nothing else to be about.
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The four sides, in the order a person's eye goes round a shape. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A number that is a number, or the one place that is safe to draw something. */
const orZero = (value: unknown): number => (finite(value) ? value : 0);

/** A box with nothing NaN about it: a rectangle with a hole in it is drawn at the origin, not nowhere. */
const sane = (rect: Rect): Rect => ({
  x: orZero(rect?.x),
  y: orZero(rect?.y),
  width: Math.max(0, orZero(rect?.width)),
  height: Math.max(0, orZero(rect?.height)),
});

/** The middle of a box, which is what one object's centre means to the other end of an arrow. */
export function centre(rect: Rect): Point {
  const box = sane(rect);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point that is a point, or `null` when the document handed over something that is not one. */
const pointOrNull = (value: unknown): Point | null => {
  if (value === null || typeof value !== 'object') return null;
  const point = value as { x?: unknown; y?: unknown };
  return finite(point.x) && finite(point.y) ? { x: point.x as number, y: point.y as number } : null;
};

/**
 * The middle of the side of `rect` that `side` names.
 *
 * This is the one place an arrow is allowed to touch an object: not its corner, not inside it, the
 * middle of the side facing wherever the arrow is going. A side of a box that is not a box — a connector
 * whose two ends are in the same place, say — still has a middle, and it is the middle of the box.
 */
export function sideAnchor(rect: Rect, side: Side): Point {
  const box = sane(rect);
  const middle = centre(box);
  switch (side) {
    case 'top':
      return { x: middle.x, y: box.y };
    case 'bottom':
      return { x: middle.x, y: box.y + box.height };
    case 'left':
      return { x: box.x, y: middle.y };
    case 'right':
      return { x: box.x + box.width, y: middle.y };
    default:
      // A side this build has never heard of came from a newer client. The middle of the box is the one
      // answer that is on the object, is finite and does not pretend to know which side was meant.
      return middle;
  }
}

/**
 * Which side of `rect` faces `toward`.
 *
 * The rule is the near side by direction and not by distance: whichever way from the centre the other
 * end lies, that is the side the arrow leaves from. It is a comparison of the two differences and
 * nothing else, which means it costs the same for a shape with a two-hundred-unit box and a shape with a
 * two-thousand-unit one, and it is the reason an arrow turns neatly through 90° as one object passes
 * another instead of sliding its anchor around the perimeter like a bead.
 *
 * On the exact diagonal the two differences are equal and either side is right; the horizontal one wins,
 * always, in both directions. A tie that went different ways on different frames would be an arrow that
 * flickers on a board nobody is touching, and that is a bug nobody would ever attribute to this function.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const aim = pointOrNull(toward);
  if (aim === null) return 'right';
  const box = centre(sane(rect));
  const dx = aim.x - box.x;
  const dy = aim.y - box.y;
  // The two ends in the same place — two shapes dropped on each other — point the arrow at the right,
  // which is where an arrow that has nowhere to go is drawn.
  if (dx === 0 && dy === 0) return 'right';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/**
 * Where an end is drawn, and where it is drawn *towards*.
 *
 * An attached end's aim is the other end's object — its centre, or the point the other end was left at
 * when there is no object to look at — and not the other end's own anchor. Both ends are therefore
 * decided by the same rule at the same time, which is what keeps an arrow straight: if the first end were
 * aimed at the second end's already-chosen anchor, an object passing over a diagonal would find each end
 * aiming at where the other one used to be and the arrow would lean.
 */
const aimOf = (end: Endpoint, rects: ReadonlyMap<string, Rect>): Point => {
  if (end?.kind === 'free') return pointOrNull(end) ?? { x: 0, y: 0 };
  if (end?.kind === 'attached') return rects.get(end.objectId) !== undefined ? centre(rects.get(end.objectId) as Rect) : pointOrNull(end.fallback) ?? { x: 0, y: 0 };
  return { x: 0, y: 0 };
};

/** Where one end is drawn: its object's near side, its own point, or the place it was left. */
const drawnAt = (end: Endpoint, rects: ReadonlyMap<string, Rect>, toward: Point): Point => {
  if (end?.kind === 'free') return pointOrNull(end) ?? toward;
  if (end?.kind !== 'attached') return toward;
  const rect = rects.get(end.objectId);
  // The object is gone. This is the one job `fallback` has: it is the anchor as it was the last time the
  // object was known to be there, so the arrow is drawn exactly where it was a moment ago instead of
  // shooting off to an origin nobody can explain.
  if (rect === undefined) return pointOrNull(end.fallback) ?? toward;
  return sideAnchor(rect, nearestSide(rect, toward));
};

/**
 * Where an arrow's two ends are drawn, given where everything on the board is.
 *
 * The two ends of one arrow are decided together and each one aims at the other, which is the whole of
 * what "the arrow follows the objects" means: nothing here is told that anything moved.
 *
 * Every input is tolerated, because the board is a document that other people write to: an end whose
 * object is missing is drawn at its fallback (TC-11), an end that is neither attached nor free is drawn
 * at its aim rather than at NaN, and a rectangle with a hole in it is drawn at the origin. An arrow that
 * threw from here would take the whole board's rendering with it, and an arrow is one object out of
 * hundreds.
 */
export function resolveEndpoints(
  connector: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const from = connector?.from;
  const to = connector?.to;
  const rectsOrDefault = rects instanceof Map ? rects : new Map<string, Rect>();
  return {
    from: drawnAt(from, rectsOrDefault, aimOf(to, rectsOrDefault)),
    to: drawnAt(to, rectsOrDefault, aimOf(from, rectsOrDefault)),
  };
}

/**
 * The box an arrow between two points covers.
 *
 * Exactly the box, with no padding invented for it: an arrow drawn straight down from one shape to
 * another shape below has no width, and a box that pretended to have one would be a box that selects an
 * arrow a marquee never came near. What an arrow really is — how near a click has to be to the line — is
 * asked of {@link distanceToPolyline} instead, and the two questions never get mixed up because this one
 * refuses to answer the second.
 */
export function connectorBBox(from: Point, to: Point): Rect {
  const a = pointOrNull(from) ?? { x: 0, y: 0 };
  const b = pointOrNull(to) ?? { x: 0, y: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
