/**
 * Rectangles, handles and scaling: the maths behind selecting and transforming several
 * board objects at once (story 7).
 *
 * Everything here is pure and in world (board) units, so it is testable without a document
 * and without a browser, and every object type uses the same maths: a type only ever says
 * how big it may get and whether it keeps its proportions (`ObjectTypeSpec`), which is read
 * by the caller and handed to `clampScale` and `resizeRect` here.
 */

/** A point in world units. */
export interface Point {
  x: number;
  y: number;
}

/** A box in world units. `x`/`y` are its top-left; width and height are never negative. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The eight resize handles of a bounding box: four corners and four edges, named after the
 * edge or corner they sit on (CSS/`cursor` naming, so `se` is the bottom-right corner).
 */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Handle order: round the box clockwise from the top-left. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The words a handle's accessible name is made from ("Resize top-left"). */
export const HANDLE_POSITION: Readonly<Record<Handle, string>> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** True when every number of the rectangle is a usable finite size and position. */
export function isFiniteRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whether `outer` holds `inner` completely: all four edges of `inner` lie inside `outer`.
 *
 * This is the marquee's containment rule - a box that only catches the corner of an object
 * does not select it. Comparisons are exact, so an object that hangs over the edge by any
 * amount at all is out, and one that sits exactly on it is in.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    isFiniteRect(outer) &&
    isFiniteRect(inner) &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest box that holds every given box, or `null` for no boxes at all. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const rect of rects) {
    if (!isFiniteRect(rect)) {
      continue;
    }
    found = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** The box between two points, whichever way round they were dragged. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * The point that does not move when `handle` is dragged: the opposite corner, or - for an
 * edge handle - the middle of the opposite edge.
 *
 * Exported because a caller that has had to clamp the scale of a resize (see
 * {@link clampScale}) still has to say where the resized box goes, and the answer is the same
 * one `resizeRect` gives: the box is put back so this point stays where it was.
 */
export function resizeAnchor(handle: Handle, start: Rect): Point {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const middleX = start.x + start.width / 2;
  const middleY = start.y + start.height / 2;
  switch (handle) {
    case 'nw':
      return { x: right, y: bottom };
    case 'n':
      return { x: middleX, y: bottom };
    case 'ne':
      return { x: start.x, y: bottom };
    case 'e':
      return { x: start.x, y: middleY };
    case 'se':
      return { x: start.x, y: start.y };
    case 's':
      return { x: middleX, y: start.y };
    case 'sw':
      return { x: right, y: start.y };
    case 'w':
      return { x: right, y: middleY };
  }
}

/**
 * The box that results from dragging `handle` by `delta` (world units), measured from where
 * it was.
 *
 * An edge handle changes one axis, a corner both, and the opposite edge or corner stays
 * where it is. With `aspectLocked` the width-to-height ratio of `start` is kept: the axis
 * that was dragged further drives the other one, and the box is put back so the anchor point
 * does not move. That is what "resizing a sticky note keeps it square" and "Shift keeps the
 * proportions" mean, for one object and for a whole selection alike.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isFiniteRect(start) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return { ...start };
  }
  const dx = delta.x;
  const dy = delta.y;
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (handle === 'e') {
    width = nonNegative(start.width + dx);
  } else if (handle === 'w') {
    width = nonNegative(start.width - dx);
    x = start.x + (start.width - width);
  }
  if (handle === 's') {
    height = nonNegative(start.height + dy);
  } else if (handle === 'n') {
    height = nonNegative(start.height - dy);
    y = start.y + (start.height - height);
  }
  // The two remaining cases move the box's edges with the pointer: the corners are handled
  // by the aspect-ratio pass below, and a corner with no lock needs no repositioning.
  if (handle === 'nw') {
    width = nonNegative(start.width - dx);
    height = nonNegative(start.height - dy);
    x = start.x + (start.width - width);
    y = start.y + (start.height - height);
  } else if (handle === 'ne') {
    width = nonNegative(start.width + dx);
    height = nonNegative(start.height - dy);
    y = start.y + (start.height - height);
  } else if (handle === 'sw') {
    width = nonNegative(start.width - dx);
    height = nonNegative(start.height + dy);
    x = start.x + (start.width - width);
  } else if (handle === 'se') {
    width = nonNegative(start.width + dx);
    height = nonNegative(start.height + dy);
  }

  if (!aspectLocked || start.width <= 0 || start.height <= 0) {
    return { x, y, width, height };
  }

  const scaleX = width / start.width;
  const scaleY = height / start.height;
  // The axis the pointer moved further along drives the other one. An edge handle moves only
  // one axis, so the other scale is exactly 1 and this picks the axis that moved.
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
  const anchor = resizeAnchor(handle, start);
  const newWidth = start.width * scale;
  const newHeight = start.height * scale;
  return {
    // Put the box back so the anchor point is where it always was.
    x: anchor.x - (anchor.x - start.x) * scale,
    y: anchor.y - (anchor.y - start.y) * scale,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * The largest scale per axis that keeps every object between its own minimum size and the
 * one global maximum, given the boxes that are being scaled together.
 *
 * One scale for the whole selection is the point: clamped per object, the objects would stop
 * moving at different times and the arrangement would come out distorted. `minSizes` lines up
 * with `rects` (a missing entry means "no minimum"). A scale already past a limit is pulled
 * back to the limit; where the minimums and the maximums cannot both be honoured (an object
 * that is already bigger than the maximum), the minimum wins, because a box the user is
 * dragging smaller must never be allowed to vanish.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let scaleX = Number.isFinite(scale.x) && scale.x > 0 ? scale.x : 1;
  let scaleY = Number.isFinite(scale.y) && scale.y > 0 ? scale.y : 1;
  let minScaleX = 0;
  let minScaleY = 0;
  let maxScaleX = Number.POSITIVE_INFINITY;
  let maxScaleY = Number.POSITIVE_INFINITY;

  rects.forEach((rect, index) => {
    if (!isFiniteRect(rect)) {
      return;
    }
    const min = minSizes[index] ?? 0;
    if (rect.width > 0) {
      if (Number.isFinite(min) && min > 0) {
        minScaleX = Math.max(minScaleX, min / rect.width);
      }
      if (Number.isFinite(maxSize) && maxSize > 0) {
        maxScaleX = Math.min(maxScaleX, maxSize / rect.width);
      }
    }
    if (rect.height > 0) {
      if (Number.isFinite(min) && min > 0) {
        minScaleY = Math.max(minScaleY, min / rect.height);
      }
      if (Number.isFinite(maxSize) && maxSize > 0) {
        maxScaleY = Math.min(maxScaleY, maxSize / rect.height);
      }
    }
  });

  scaleX = minScaleX > maxScaleX ? minScaleX : Math.min(Math.max(scaleX, minScaleX), maxScaleX);
  scaleY = minScaleY > maxScaleY ? minScaleY : Math.min(Math.max(scaleY, minScaleY), maxScaleY);
  return { x: scaleX, y: scaleY };
}

/**
 * Where `child` goes when the box it lives in moves from `from` to `to`: position and size
 * both scale by the box's factor on each axis, so gaps between objects scale with the box and
 * the arrangement of the selection survives the resize.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(child) || !isFiniteRect(from) || !isFiniteRect(to)) {
    return { ...child };
  }
  if (from.width <= 0 || from.height <= 0) {
    return { ...child };
  }
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}

/** Whether `point` lies inside `rect` (used for hit-testing an object). */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    isFiniteRect(rect) &&
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * The box `start` scaled by `scale` on each axis, with `anchor` left where it is.
 *
 * `resizeRect` says how big a dragged box wants to be; when that size has to be clamped first,
 * this is how the box is put back together so the edge the pointer is not dragging - the anchor
 * from {@link resizeAnchor} - stays put.
 */
export function scaleRect(start: Rect, scale: Point, anchor: Point): Rect {
  if (!isFiniteRect(start) || !isFiniteRect(rectOfScale(start, scale))) {
    return { ...start };
  }
  return {
    x: anchor.x - (anchor.x - start.x) * scale.x,
    y: anchor.y - (anchor.y - start.y) * scale.y,
    width: start.width * scale.x,
    height: start.height * scale.y,
  };
}

function rectOfScale(start: Rect, scale: Point): Rect {
  return {
    x: start.x,
    y: start.y,
    width: start.width * scale.x,
    height: start.height * scale.y,
  };
}
