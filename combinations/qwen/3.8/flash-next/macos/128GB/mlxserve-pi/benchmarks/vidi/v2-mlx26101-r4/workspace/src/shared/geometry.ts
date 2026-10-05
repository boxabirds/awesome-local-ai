/**
 * The maths of selection and transformation: rectangles in world units, and the
 * few operations the board performs on them.
 *
 * Everything here is pure and framework-free — no React, no DOM, no Yjs — because
 * the same numbers are needed by the selection overlay (which draws them on
 * screen), by the transform gesture (which writes them into the document) and by
 * the unit tests (which are the only honest way to check that a resize stops
 * exactly at a limit). A world unit is a board unit: nothing in this file knows
 * about zoom or about pixels, except `HANDLE_SIZE_PX`, which is a screen
 * measurement and deliberately not here.
 *
 * A `Rect` is always top-left plus size. `normalizeRect` is the only function that
 * turns two dragged points into one, so "the rectangle the marquee drew" has one
 * definition in the product.
 */

/** A point in world units. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle in world units: top-left corner and size. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The eight handles of a bounding box, named for the edge or corner they sit on:
 * `n` is the middle of the top edge, `se` is the bottom-right corner.
 */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order an overlay should draw them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The accessible name of a handle, e.g. `aria-label="Resize top-left"`. */
export const HANDLE_LABELS: Record<Handle, string> = {
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
  nw: 'Resize top-left',
};

/** `width`/`height` that are numbers at all, and a position that is a point. */
function finiteRect(rect: Rect | undefined | null): rect is Rect {
  return (
    !!rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function positiveRect(rect: Rect | undefined | null): rect is Rect {
  return finiteRect(rect) && rect.width > 0 && rect.height > 0;
}

/** True when the point is a real place on the board. */
export function finitePoint(point: Point | undefined | null): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Whether `inner` lies entirely inside `outer`, edges included.
 *
 * This is the marquee's containment rule: an object that is only partly inside, or
 * that merely touches the rectangle from outside, is not selected. The comparison
 * is inclusive on purpose — an object whose edge lands exactly on the rectangle's
 * edge was inside the box the person drew.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finiteRect(outer) || !finiteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rectangle that covers every given rectangle, or `null` when there
 * is nothing to cover. `null` rather than a zero rectangle, because the callers all
 * have a real answer for "there is no selection" (draw nothing) and none for
 * "there is a selection of no size".
 */
export function unionRects(rects: Rect[]): Rect | null {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const rect of rects) {
    if (!finiteRect(rect)) continue;
    found = true;
    x1 = Math.min(x1, rect.x);
    y1 = Math.min(y1, rect.y);
    x2 = Math.max(x2, rect.x + rect.width);
    y2 = Math.max(y2, rect.y + rect.height);
  }
  if (!found) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * The rectangle between two points, however they were dragged: right-to-left,
 * bottom-to-top or the other way round all give the same rectangle. Used for the
 * marquee, whose start and end are whichever way the pointer went.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finitePoint(a) || !finitePoint(b)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Which edge of `rect` a handle drags, as -1 (the left/top edge moves), 0 (that
 * axis is not dragged) or 1 (the right/bottom edge moves).
 */
function handleAxis(handle: Handle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
    // `n` is the top edge, so dragging it north (a negative delta) makes it taller.
    y: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
  };
}

/**
 * The point of `rect` that a handle keeps where it is. A corner holds the opposite
 * corner, an edge holds the middle of the opposite edge — which is what lets an
 * edge handle with the proportions locked grow the other axis evenly about the box
 * instead of pushing the whole box away.
 */
export function anchorPoint(rect: Rect, handle: Handle): Point {
  const axis = handleAxis(handle);
  return {
    x: axis.x === 1 ? rect.x : axis.x === -1 ? rect.x + rect.width : rect.x + rect.width / 2,
    y: axis.y === 1 ? rect.y : axis.y === -1 ? rect.y + rect.height : rect.y + rect.height / 2,
  };
}

/**
 * The rectangle of the given size whose anchor for this handle is `anchor` — the
 * exact inverse of `anchorPoint`, so a box can be rebuilt from a scale without
 * moving the side the person is holding.
 */
export function boxFromAnchor(handle: Handle, anchor: Point, width: number, height: number): Rect {
  const axis = handleAxis(handle);
  return {
    x: axis.x === 1 ? anchor.x : axis.x === -1 ? anchor.x - width : anchor.x - width / 2,
    y: axis.y === 1 ? anchor.y : axis.y === -1 ? anchor.y - height : anchor.y - height / 2,
    width,
    height,
  };
}

/**
 * Drag one handle of `start` by `delta` (world units) and return the new box.
 *
 * An edge handle changes one axis only; a corner changes both. With `aspectLocked`
 * the width-to-height ratio of the box is kept, and the axis the pointer moved
 * *further* along decides the scale — that is the axis the person is aiming with,
 * and the other one follows it. The box is built about the anchor of the handle, so
 * the side being held is the side that moves and the opposite one stays put.
 *
 * Nothing here knows about minimum or maximum sizes: that is `clampScale`'s job, and
 * keeping the two apart is what makes the limit testable on its own.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!finiteRect(start) || !finitePoint(delta)) return finiteRect(start) ? { ...start } : { x: 0, y: 0, width: 0, height: 0 };

  const axis = handleAxis(handle);
  const width = start.width + axis.x * delta.x;
  const height = start.height + axis.y * delta.y;

  if (!aspectLocked || !(start.width > 0) || !(start.height > 0)) {
    return boxFromAnchor(handle, anchorPoint(start, handle), width, height);
  }

  const scaleX = width / start.width;
  const scaleY = height / start.height;
  // The axis the pointer travelled further along is the one that decides how much
  // the box grows or shrinks; a handle that drags only one axis has nothing to choose.
  const scale =
    Math.abs(delta.x * axis.x) > Math.abs(delta.y * axis.y)
      ? scaleX
      : Math.abs(delta.y * axis.y) > Math.abs(delta.x * axis.x)
        ? scaleY
        : Math.max(scaleX, scaleY);

  return boxFromAnchor(handle, anchorPoint(start, handle), start.width * scale, start.height * scale);
}

/**
 * The one scale at which no selected object crosses its own minimum or the board's
 * maximum, given the scale the pointer asked for.
 *
 * The scale is clamped once, for the whole selection, rather than per object: objects
 * that stopped at different times would stop being a layout. `rects[i]` belongs to
 * `minSizes[i]`; the maximum is one board-wide setting for every type. A scale that
 * is not a number is no scale at all, so the answer is "don't resize" (1, 1).
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let minX = 0;
  let minY = 0;
  let maxX = Number.POSITIVE_INFINITY;
  let maxY = Number.POSITIVE_INFINITY;

  rects.forEach((rect, index) => {
    if (!positiveRect(rect)) return;
    const min = Number.isFinite(minSizes[index]) && minSizes[index] > 0 ? minSizes[index] : 0;
    if (Number.isFinite(maxSize) && maxSize > 0) {
      maxX = Math.min(maxX, maxSize / rect.width);
      maxY = Math.min(maxY, maxSize / rect.height);
    }
    minX = Math.max(minX, min / rect.width);
    minY = Math.max(minY, min / rect.height);
  });

  const clamp = (requested: number, low: number, high: number): number => {
    // No scale asked for is no change: the caller may write the box back unchanged.
    if (!Number.isFinite(requested)) return 1;
    // The maximum wins over the minimum when an object is already past one of them,
    // because a resize is never allowed to make the bigger problem bigger.
    if (requested > high) return high;
    if (requested < low) return high < low ? high : low;
    return requested;
  };

  return {
    x: clamp(scale.x, minX, maxX),
    y: clamp(scale.y, minY, maxY),
  };
}

/**
 * Where `child` ends up when the box it belongs to is moved and stretched from
 * `from` to `to`: position and size are both scaled about the top-left of the box,
 * so the layout inside the selection is kept — objects spread apart exactly as far
 * as the box grew.
 *
 * A box with no width or height cannot be scaled (there is nothing to divide by), so
 * those axes are left alone rather than producing infinities.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!finiteRect(child) || !finiteRect(from) || !finiteRect(to)) {
    return finiteRect(child) ? { ...child } : { x: 0, y: 0, width: 0, height: 0 };
  }
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
