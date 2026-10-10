/**
 * Pure board geometry (anchor `sel.geometry_ops`).
 *
 * World-unit rectangles and points, with no DOM and no React. Everything the
 * selection machinery needs - marquee containment, the bounding box of a
 * selection, resizing that box from a handle, clamping a resize so no object
 * crosses its size limits, and mapping one object's rect from the old box into
 * the new one - is here, so the same maths works for every object type.
 */

/** A rectangle in board units: top-left corner plus size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A point in board units. Structurally identical to the camera's `Point`, so
 * screen and world points can be passed to the same maths.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One of the 8 bounding-box handles: 4 corners, 4 edges. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The 8 handles, in clockwise order from the top edge. */
export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Accessible position name of a handle: `top-left`, `right`, `bottom`, ... */
export const HANDLE_POSITION_NAMES: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** Is `value` a number a rectangle can actually be built from? */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A rect is usable when all four of its numbers are finite. */
export function isFiniteRect(rect: Rect): boolean {
  return (
    isFiniteNumber(rect?.x) &&
    isFiniteNumber(rect?.y) &&
    isFiniteNumber(rect?.width) &&
    isFiniteNumber(rect?.height)
  );
}

/** A point is usable when both of its numbers are finite. */
export function isFinitePoint(point: Point): boolean {
  return isFiniteNumber(point?.x) && isFiniteNumber(point?.y);
}

/**
 * Tolerance for "entirely inside". Marquee rectangles and object bounds are both
 * computed from world coordinates, so a difference of a trillionth of a board
 * unit is measurement, not a partially-inside object.
 */
const EPSILON = 1e-6;

/** A scale factor cannot be smaller than this: a rect never collapses to zero. */
const MIN_SCALE = 1e-6;

/**
 * Is `inner` **entirely** inside `outer`? Lying exactly on the border counts;
 * hanging out by any amount, or merely touching from outside, does not
 * (`sel.marquee`). Non-finite input answers false rather than true.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) {
    return false;
  }
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

/** Is `point` inside `rect` (borders included)? */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
  if (!isFiniteRect(rect) || !isFinitePoint(point)) {
    return false;
  }
  return (
    point.x >= rect.x - EPSILON &&
    point.x <= rect.x + rect.width + EPSILON &&
    point.y >= rect.y - EPSILON &&
    point.y <= rect.y + rect.height + EPSILON
  );
}

/** The smallest box that holds every given rect. `null` when there are none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (!isFiniteRect(rect)) {
      continue;
    }
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (maxX === Number.NEGATIVE_INFINITY || maxY === Number.NEGATIVE_INFINITY) {
    return null; // no usable rects: an empty selection has no bounding box
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rectangle between two dragged points, whichever way they were dragged. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!isFinitePoint(a) || !isFinitePoint(b)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Which corner of the starting rect a handle pins down, and which axes the
 * handle moves. Dragging the bottom-right handle moves the box from its
 * top-left corner; dragging the left edge moves only the width, and pins the
 * right edge (`sel.resize`).
 */
type Corner = 'nw' | 'ne' | 'sw' | 'se';

const HANDLE_RULES: Record<Handle, { anchor: Corner; axes: 'x' | 'y' | 'both' }> = {
  nw: { anchor: 'se', axes: 'both' },
  n: { anchor: 'sw', axes: 'y' },
  ne: { anchor: 'sw', axes: 'both' },
  e: { anchor: 'nw', axes: 'x' },
  se: { anchor: 'nw', axes: 'both' },
  s: { anchor: 'nw', axes: 'y' },
  sw: { anchor: 'ne', axes: 'both' },
  w: { anchor: 'ne', axes: 'x' },
};

const cornerPoint = (rect: Rect, corner: Corner): Point => {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  switch (corner) {
    case 'nw':
      return { x: left, y: top };
    case 'ne':
      return { x: right, y: top };
    case 'sw':
      return { x: left, y: bottom };
    case 'se':
      return { x: right, y: bottom };
  }
};

/** How far a drag in `delta` grows this handle's box, before any locking. */
const growthFactor = (start: Rect, handle: Handle, delta: Point): { x: number; y: number } => {
  const rule = HANDLE_RULES[handle];
  // A handle pinned to the left side grows the width when dragged right; one
  // pinned to the right side grows it when dragged left.
  const signX = rule.anchor === 'nw' || rule.anchor === 'sw' ? 1 : -1;
  const signY = rule.anchor === 'nw' || rule.anchor === 'ne' ? 1 : -1;
  const width = start.width > 0 ? start.width : EPSILON;
  const height = start.height > 0 ? start.height : EPSILON;
  const rawX = (width + signX * delta.x) / width;
  const rawY = (height + signY * delta.y) / height;
  return {
    x: rule.axes === 'y' ? 1 : Math.max(rawX, MIN_SCALE),
    y: rule.axes === 'x' ? 1 : Math.max(rawY, MIN_SCALE),
  };
};

/**
 * Drag a bounding-box handle: the new rect, anchored at the opposite corner or
 * edge (`sel.resize`).
 *
 * `aspectLocked` (sticky notes, or Shift held) keeps the box's ratio, using the
 * axis the pointer moved furthest along so the box follows the drag rather than
 * lagging behind it (`sel.aspect`).
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isFiniteRect(start) || !isFinitePoint(delta) || !HANDLE_RULES[handle]) {
    return { ...start };
  }
  const rule = HANDLE_RULES[handle];
  let scale = growthFactor(start, handle, delta);
  if (aspectLocked) {
    // One factor for both axes, taken from the axis that moved most in
    // proportion: an edge handle with Shift still keeps the ratio.
    const factor =
      Math.abs(scale.y - 1) > Math.abs(scale.x - 1) ? scale.y : Math.max(scale.x, MIN_SCALE);
    scale = { x: factor, y: factor };
  }
  return rectFromAnchor(start, rule.anchor, start.width * scale.x, start.height * scale.y);
}

/** Rebuild a rect of the given size pinned to `start`'s corner `anchor`. */
function rectFromAnchor(start: Rect, anchor: Corner, width: number, height: number): Rect {
  const fixed = cornerPoint(start, anchor);
  switch (anchor) {
    case 'nw':
      return { x: fixed.x, y: fixed.y, width, height };
    case 'ne':
      return { x: fixed.x - width, y: fixed.y, width, height };
    case 'sw':
      return { x: fixed.x, y: fixed.y - height, width, height };
    case 'se':
      return { x: fixed.x - width, y: fixed.y - height, width, height };
  }
}

/**
 * The same resize, from a scale factor that has already been clamped
 * (`clampScale`). The gesture needs this to apply the clamped scale to the box
 * it computed with `resizeRect`.
 */
export function resizeRectFromScale(
  start: Rect,
  handle: Handle,
  scale: Point,
): Rect {
  if (!isFiniteRect(start) || !isFinitePoint(scale) || !HANDLE_RULES[handle]) {
    return { ...start };
  }
  const rule = HANDLE_RULES[handle];
  return rectFromAnchor(
    start,
    rule.anchor,
    start.width * Math.max(scale.x, MIN_SCALE),
    start.height * Math.max(scale.y, MIN_SCALE),
  );
}

const clampFactor = (factor: number, min: number, max: number): number => {
  if (!isFiniteNumber(factor)) {
    return 1;
  }
  // `min` is the harder rule when the two cannot both be honoured: an object is
  // never allowed below its type's minimum size.
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(factor, min), max);
};

/**
 * The scale a group resize may actually use (`sel.size_limits`).
 *
 * Every selected object contributes two lower bounds (its type's `minSize`
 * divided by its own size) and two upper bounds (MAX_OBJECT_SIZE_WORLD divided
 * by its own size). The answer is one scale for the whole selection, so the
 * selection stops as a group as soon as the first object reaches a limit -
 * objects never stop at different times and distort the layout.
 *
 * When the requested scale is uniform (the aspect-locked case) the answer is
 * uniform too, so ratios survive the clamp.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  if (!isFinitePoint(scale) || !isFiniteNumber(maxSize) || maxSize <= 0) {
    return { x: 1, y: 1 };
  }
  let minX = MIN_SCALE;
  let minY = MIN_SCALE;
  let maxX = Number.POSITIVE_INFINITY;
  let maxY = Number.POSITIVE_INFINITY;
  let sawRect = false;

  rects.forEach((rect, index) => {
    if (!isFiniteRect(rect)) {
      return;
    }
    sawRect = true;
    const minSize = isFiniteNumber(minSizes[index]) ? Math.max(minSizes[index]!, 0) : 0;
    if (rect.width > 0) {
      minX = Math.max(minX, minSize / rect.width, MIN_SCALE);
      maxX = Math.min(maxX, maxSize / rect.width);
    }
    if (rect.height > 0) {
      minY = Math.max(minY, minSize / rect.height, MIN_SCALE);
      maxY = Math.min(maxY, maxSize / rect.height);
    }
  });

  if (!sawRect) {
    // Nothing to size against: the request stands.
    return { x: Math.max(scale.x, MIN_SCALE), y: Math.max(scale.y, MIN_SCALE) };
  }

  const uniform = Math.abs(scale.x - scale.y) <= EPSILON * Math.max(1, Math.abs(scale.x));
  if (uniform) {
    const factor = clampFactor(scale.x, Math.max(minX, minY), Math.min(maxX, maxY));
    return { x: factor, y: factor };
  }
  return {
    x: clampFactor(scale.x, minX, maxX),
    y: clampFactor(scale.y, minY, maxY),
  };
}

/**
 * Where one object ends up when the box it lives in moves from `from` to `to`:
 * its position and its size are scaled by the box's own change, so offsets and
 * gaps scale with it (`sel.group_resize`).
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(child) || !isFiniteRect(from) || !isFiniteRect(to)) {
    return { ...child };
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
