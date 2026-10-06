/**
 * Rectangles, points and the maths a selection is made of.
 *
 * Everything here is in world units and pure: the marquee's containment test, the bounding box
 * of a selection, the box a handle drag describes, the one scale a whole selection stops at, and
 * the mapping of one object into a resized box. Stories 9–12 use the same functions for shapes,
 * text, drawings and images, which is why nothing in here knows what a sticky note is.
 *
 * Two rules run through the whole file. A number that is not a number is never written to the
 * board and never used to move anything: a function that is handed `NaN` says "no change". And
 * a selection is resized as *one* object: every object in it moves by the same scale, so the
 * layout the person made is what gets bigger, not a pile of notes that drift apart.
 */

/** A point, in world units. Structurally the same as the camera's `Point`. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle in world units: top-left corner plus size. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles of a bounding box: four corners, four edges. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order the overlay renders them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * How far past the frame an edge may be and still count as inside.
 *
 * A marquee is drawn by a pointer and a zoom divide, so a note that was dragged up to the frame
 * lands a few ten-thousandths outside it half the time. The PRD's rule is about what a person
 * can see; this is the dust that floating point leaves behind, and nothing more.
 */
const CONTAIN_EPSILON = 1e-9;

const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const finitePoint = (point: Point): boolean => num(point.x) && num(point.y);

const finiteRect = (rect: Rect): boolean =>
  num(rect.x) && num(rect.y) && num(rect.width) && num(rect.height);

/** True when `inner` lies entirely inside `outer`, edges included. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finiteRect(outer) || !finiteRect(inner)) return false;
  // A rectangle with no area contains nothing: a marquee that has not been dragged yet, and an
  // object that has been squashed to a line, which is not something to select.
  if (outer.width <= 0 || outer.height <= 0) return false;
  if (inner.width <= 0 || inner.height <= 0) return false;
  return (
    inner.x >= outer.x - CONTAIN_EPSILON &&
    inner.y >= outer.y - CONTAIN_EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + CONTAIN_EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + CONTAIN_EPSILON
  );
}

/**
 * True when a point lies on `rect`, edges included.
 *
 * Story 7 needs this next to `rectContains` rather than a rectangle built around the point, because a
 * point has no area and `rectContains` refuses an inner rectangle that has none — which is right for
 * a marquee and wrong for a pointer.
 */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
  if (!finiteRect(rect) || !finitePoint(point)) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    point.x >= rect.x - CONTAIN_EPSILON &&
    point.x <= rect.x + rect.width + CONTAIN_EPSILON &&
    point.y >= rect.y - CONTAIN_EPSILON &&
    point.y <= rect.y + rect.height + CONTAIN_EPSILON
  );
}

/** The smallest rectangle that holds every rectangle handed to it, or null when there are none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const rect of rects) {
    if (!finiteRect(rect) || rect.width <= 0 || rect.height <= 0) continue;
    found = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!found) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rectangle between two pointer points, whichever way round they came. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finitePoint(a) || !finitePoint(b)) {
    // A pointer that reports something that is not a number drags nothing: an empty rectangle at
    // whichever point is still usable.
    const anchor = finitePoint(a) ? a : finitePoint(b) ? b : { x: 0, y: 0 };
    return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

const isEast = (handle: Handle): boolean => handle === 'e' || handle === 'ne' || handle === 'se';
const isWest = (handle: Handle): boolean => handle === 'w' || handle === 'nw' || handle === 'sw';
const isNorth = (handle: Handle): boolean => handle === 'n' || handle === 'ne' || handle === 'nw';
const isSouth = (handle: Handle): boolean => handle === 's' || handle === 'se' || handle === 'sw';

/**
 * The box a handle drag describes: the box the pointer *asks* for, before the minimum and maximum
 * sizes are applied ({@link clampScale} does that, because it has to look at every object).
 *
 * The corner the pointer is not holding stays where it was, which is what makes a resize feel
 * like pulling a corner rather than moving a box. When `aspectLocked` is on — an object whose
 * proportions matter, or Shift — the direction the pointer moved furthest decides both sides,
 * and a handle that only pulls one way grows the other way about the middle.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!finiteRect(start)) return { x: 0, y: 0, width: 0, height: 0 };
  // A pointer direction that is not a number moved nowhere in that direction.
  const dx = num(delta.x) ? delta.x : 0;
  const dy = num(delta.y) ? delta.y : 0;
  const east = isEast(handle);
  const west = isWest(handle);
  const north = isNorth(handle);
  const south = isSouth(handle);
  // Pulling west or north pushes the far edge, so the size grows by the opposite of the pointer.
  let width = start.width + (east ? dx : west ? -dx : 0);
  let height = start.height + (south ? dy : north ? -dy : 0);
  if (aspectLocked && start.width > 0 && start.height > 0) {
    const scale =
      Math.abs(dx) / start.width >= Math.abs(dy) / start.height
        ? width / start.width
        : height / start.height;
    width = start.width * scale;
    height = start.height * scale;
  }
  width = Math.max(0, width);
  height = Math.max(0, height);
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  return {
    x: west ? right - width : east ? start.x : start.x + (start.width - width) / 2,
    y: north ? bottom - height : south ? start.y : start.y + (start.height - height) / 2,
    width,
    height,
  };
}

/**
 * The one scale a whole selection stops at.
 *
 * A group is resized as a unit, so a single scale has to serve every object in it: the first
 * object to reach its own minimum, or the shared maximum, stops all of them. `minSizes` is one
 * entry per entry of `rects` — an object type's minimum is its own, which is why a selection of a
 * big note and a small one stops at the small one's limit.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  if (!finitePoint(scale)) return { x: 1, y: 1 };
  let sx = scale.x;
  let sy = scale.y;
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect || !finiteRect(rect) || rect.width <= 0 || rect.height <= 0) continue;
    const min = num(minSizes[index]) ? (minSizes[index] as number) : 0;
    if (rect.width * sx < min) sx = min / rect.width;
    if (rect.height * sy < min) sy = min / rect.height;
    if (num(maxSize) && maxSize > 0) {
      if (rect.width * sx > maxSize) sx = maxSize / rect.width;
      if (rect.height * sy > maxSize) sy = maxSize / rect.height;
    }
  }
  return { x: sx, y: sy };
}

/**
 * The box a selection ends up in when it is scaled by `scale`, held still on the edges the handle
 * did not move.
 *
 * {@link resizeRect} answers a question about the pointer — how far did it go — and this answers the
 * question that comes after it: the gesture has asked for a size, the objects' own minimum and
 * maximum sizes have answered with the largest scale they allow, and what is wanted now is the box of
 * *that* size, in the place the drag was holding still. Pulling the west edge moves the west edge;
 * pulling the east edge moves everything except the west edge; pulling a top edge holds the bottom.
 *
 * Which is why this is not `resizeRect` called twice with a corrected delta: the second call would
 * have to know what the first one settled on, and a resize whose scale was stopped by a minimum is
 * the one resize where those two answers differ.
 */
export function scaleRect(start: Rect, handle: Handle, scale: Point): Rect {
  if (!finiteRect(start)) return { x: 0, y: 0, width: 0, height: 0 };
  // A scale that is not a number scaled nothing, which is the same answer as a scale of 1.
  const width = Math.max(0, start.width * (num(scale.x) ? scale.x : 1));
  const height = Math.max(0, start.height * (num(scale.y) ? scale.y : 1));
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  return {
    x: isWest(handle) ? right - width : isEast(handle) ? start.x : start.x + (start.width - width) / 2,
    y: isNorth(handle) ? bottom - height : isSouth(handle) ? start.y : start.y + (start.height - height) / 2,
    width,
    height,
  };
}

/**
 * Where an object lands inside a resized box: the same fraction of the way across it, and scaled
 * by the same factor in both directions, so gaps between objects scale with the objects.
 *
 * This is the whole of "scale relative positions": `from` is the bounding box when the drag
 * started, `to` is where that box is now — and it is anchored on `to`, because a drag of the west
 * edge moves the box as well as sizes it. An object welded to the edge that moved goes with it,
 * which is what "the corner the pointer is holding stays still" means when there are twenty objects
 * in the box instead of one.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!finiteRect(child) || !finiteRect(from) || !finiteRect(to)) return child;
  if (from.width <= 0 || from.height <= 0) return child;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return child;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
