/**
 * Rectangle maths for selecting and transforming board objects.
 *
 * Everything here is pure and works in world units, so it can be tested without a
 * document, a DOM or a camera. `board-model` uses it to decide what a marquee
 * contains, `useTransformGesture` uses it to turn a pointer delta into a resized
 * selection, and the overlay uses it to find the box around a selection.
 *
 * A `Rect` is always stored as a top-left plus a size. A rectangle produced by
 * dragging two corners goes through `normalizeRect` first, so nothing downstream
 * has to wonder whether `width` is negative.
 */

/** An axis-aligned rectangle in world units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in world units (the same shape the camera module uses). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The eight resize handles of a bounding box, named for the edge or corner they
 * sit on: `nw` is the top-left corner, `e` the middle of the right edge.
 */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The name the client code and this story's design use for the same thing. */
export type HandleId = Handle;

/** Every handle, in the order the overlay draws them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Accessible names, so a handle is not described by its geometry alone. */
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

/** A rectangle whose every corner the maths can use. */
export function isFiniteRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

/**
 * True when `inner` lies entirely inside `outer`: all four of its edges are on or
 * within the outer rectangle's. An object that is partly outside is *not*
 * contained, which is the rule the marquee uses (`sel.marquee`).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest rectangle covering every argument, or `null` for no rectangles. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const rect of rects) {
    if (!isFiniteRect(rect)) continue;
    found = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!found) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rectangle between two dragged corners, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function isEast(handle: Handle): boolean {
  return handle === 'e' || handle === 'ne' || handle === 'se';
}

function isWest(handle: Handle): boolean {
  return handle === 'w' || handle === 'nw' || handle === 'sw';
}

function isNorth(handle: Handle): boolean {
  return handle === 'n' || handle === 'nw' || handle === 'ne';
}

function isSouth(handle: Handle): boolean {
  return handle === 's' || handle === 'sw' || handle === 'se';
}

/** True when the handle drives the horizontal axis at all. */
function isHorizontal(handle: Handle): boolean {
  return isEast(handle) || isWest(handle);
}

/**
 * A box of `width` × `height` placed where `handle` of `start` would put it: the
 * anchor of that handle stays exactly where it was.
 *
 * The anchor of a corner is the opposite corner; the anchor of an edge is that
 * edge's own line, with the cross axis free to grow about the centre when a ratio
 * lock changes it.
 */
export function anchoredRect(
  start: Rect,
  handle: Handle,
  width: number,
  height: number,
): Rect {
  const centreX = start.x + start.width / 2;
  const centreY = start.y + start.height / 2;
  let x = centreX - width / 2;
  let y = centreY - height / 2;
  if (isEast(handle)) x = start.x;
  if (isWest(handle)) x = start.x + start.width - width;
  if (isSouth(handle)) y = start.y;
  if (isNorth(handle)) y = start.y + start.height - height;
  return { x, y, width, height };
}

/**
 * The box that results from dragging `handle` of `start` by `delta`.
 *
 * The opposite corner or edge is the anchor and does not move. An edge handle
 * changes one axis, a corner handle both. With `aspectLocked` the start box's
 * ratio is kept: the axis the pointer moved further along drives the resize and
 * the other axis follows.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return start;
  if (!isFiniteRect(start)) return start;

  // Signed growth along each axis: dragging the west handle left grows the box.
  const growthX = isEast(handle) ? delta.x : isWest(handle) ? -delta.x : 0;
  const growthY = isSouth(handle) ? delta.y : isNorth(handle) ? -delta.y : 0;
  const width = Math.max(0, start.width + growthX);
  const height = Math.max(0, start.height + growthY);

  if (!aspectLocked) return anchoredRect(start, handle, width, height);

  // One ratio for the box: the axis the pointer moved further along leads, and a
  // box that started flat (ratio 0 or infinite) keeps the other axis unchanged.
  const scale = aspectScale(start, handle, width, height, growthX, growthY);
  return anchoredRect(start, handle, start.width * scale, start.height * scale);
}

/** The scale a ratio-locked resize ends up with. */
function aspectScale(
  start: Rect,
  handle: Handle,
  width: number,
  height: number,
  growthX: number,
  growthY: number,
): number {
  const scaleOnX = start.width > 0 ? width / start.width : 1;
  const scaleOnY = start.height > 0 ? height / start.height : 1;
  if (!isHorizontal(handle)) return scaleOnY;
  if (!isSouth(handle) && !isNorth(handle)) return scaleOnX;
  // A corner: the pointer's own movement decides, not the resulting sizes, so a
  // long drag sideways and a short one down reads as "wider", both ways.
  return Math.abs(growthX) >= Math.abs(growthY) ? scaleOnX : scaleOnY;
}

/**
 * The largest scale in `scale`'s direction that keeps every rectangle inside its
 * own minimum size and `maxSize`.
 *
 * One scale for the whole selection: the first object to reach a limit stops
 * every object, so the arrangement does not distort (`sel.size_limits`).
 * `minSizes[i]` belongs to `rects[i]`. A scale that is not finite comes back as
 * `{ x: 1, y: 1 }`, which changes nothing.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y)) return { x: 1, y: 1 };

  let lowestX = 0;
  let highestX = Number.POSITIVE_INFINITY;
  let lowestY = 0;
  let highestY = Number.POSITIVE_INFINITY;

  rects.forEach((rect, index) => {
    if (!isFiniteRect(rect) || rect.width <= 0 || rect.height <= 0) return;
    const min = Number.isFinite(minSizes[index] ?? 0) ? (minSizes[index] ?? 0) : 0;
    // Every limit as a bound on the scale itself, so the whole selection shares
    // the one that bites first.
    lowestX = Math.max(lowestX, min / rect.width);
    lowestY = Math.max(lowestY, min / rect.height);
    if (Number.isFinite(maxSize) && maxSize > 0) {
      highestX = Math.min(highestX, maxSize / rect.width);
      highestY = Math.min(highestY, maxSize / rect.height);
    }
  });

  // A minimum larger than the maximum (a limit set badly) keeps the object where
  // it is rather than teleporting it to one limit or the other.
  const clampAxis = (requested: number, lowest: number, highest: number): number => {
    if (lowest > highest) return 1;
    return Math.min(highest, Math.max(lowest, requested));
  };

  return {
    x: clampAxis(scale.x, lowestX, highestX),
    y: clampAxis(scale.y, lowestY, highestY),
  };
}

/**
 * `child` re-placed and re-scaled from living inside `from` to living inside `to`.
 *
 * Positions and sizes are mapped by the same ratios, so a layout inside a
 * bounding box keeps its proportions and its gaps when the box is resized.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(child) || !isFiniteRect(from) || !isFiniteRect(to)) return child;
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
