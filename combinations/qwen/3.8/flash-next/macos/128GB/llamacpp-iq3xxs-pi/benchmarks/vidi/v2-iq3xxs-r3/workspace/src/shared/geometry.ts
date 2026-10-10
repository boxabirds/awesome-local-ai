/**
 * Rectangles and points in board coordinates: the whole of the maths behind
 * marquee selection, the selection's bounding box, group resizing and the size
 * limits (story 7, `sel.geometry_ops`).
 *
 * Nothing here knows about Yjs, React or the DOM: every function is total
 * (invalid input yields a defined result, never a throw), because a gesture that
 * produced a `NaN` must be refused rather than crash the board.
 */

/** A point in world units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in world units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The eight resize handles of a bounding box: corners and edge midpoints. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order a keyboard user meets them (top-left, clockwise). */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The accessible position of each handle, for `aria-label="Resize top-left"`. */
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** True for a number that can be a coordinate; `NaN` and ±Infinity cannot. */
const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

/** True when every number given is finite. */
const allFinite = (...values: number[]): boolean => values.every(isFiniteNumber);

/**
 * True when `inner` lies entirely inside `outer`: the marquee takes only an
 * object it has fully covered, and an object whose edge lies exactly on the
 * marquee's edge counts as covered, because that is a rule you can reproduce
 * with a ruler. A rectangle that is not a rectangle — `NaN` from a broken
 * gesture — contains nothing and is contained by nothing.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (
    !allFinite(outer.x, outer.y, outer.width, outer.height) ||
    !allFinite(inner.x, inner.y, inner.width, inner.height)
  ) {
    return false;
  }
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The bounding box of `rects`, or `null` when there is nothing to draw a box
 * around. Rectangles that are not rectangles are left out rather than guessed at.
 */
export function unionRects(rects: Rect[]): Rect | null {
  let box: Rect | null = null;
  for (const rect of rects) {
    if (!allFinite(rect.x, rect.y, rect.width, rect.height)) continue;
    if (!box) {
      box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      continue;
    }
    const left = Math.min(box.x, rect.x);
    const top = Math.min(box.y, rect.y);
    const right = Math.max(box.x + box.width, rect.x + rect.width);
    const bottom = Math.max(box.y + box.height, rect.y + rect.height);
    box = { x: left, y: top, width: right - left, height: bottom - top };
  }
  return box;
}

/** A coordinate a drag could honestly have reached; otherwise the other point's. */
const finiteAxis = (value: number, instead: number): number =>
  isFiniteNumber(value) ? value : isFiniteNumber(instead) ? instead : 0;

/**
 * The rectangle between two dragged points, whichever way the pointer went. A
 * point that reported nonsense collapses onto the other one, so a broken event
 * gives a rectangle of nothing rather than a rectangle of `NaN`.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const ax = finiteAxis(a.x, b.x);
  const ay = finiteAxis(a.y, b.y);
  const bx = finiteAxis(b.x, a.x);
  const by = finiteAxis(b.y, a.y);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

/** Which edges this handle drags: the other side of the box stays where it was. */
export const handleMovesLeft = (handle: Handle): boolean =>
  handle === 'w' || handle === 'nw' || handle === 'sw';
export const handleMovesRight = (handle: Handle): boolean =>
  handle === 'e' || handle === 'ne' || handle === 'se';
export const handleMovesTop = (handle: Handle): boolean =>
  handle === 'n' || handle === 'nw' || handle === 'ne';
export const handleMovesBottom = (handle: Handle): boolean =>
  handle === 's' || handle === 'sw' || handle === 'se';



/**
 * Drag `handle` of `start` by `delta` (world units). The opposite corner or edge
 * keeps its place, which is what makes a resize feel anchored: an `nw` drag holds
 * the bottom-right corner still while the box grows away from it. Edge handles
 * move one axis, corners both.
 *
 * With `aspectLocked` the starting ratio is kept, taken from whichever axis the
 * pointer moved further along (`sel.resize`: pushing the corner of a note
 * outwards sideways must not turn it into a banner just because the hand drifted).
 *
 * A box never turns inside out: a drag past the opposite edge stops at a side of
 * nought, and the size limits of the objects inside decide what happens next.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!allFinite(start.x, start.y, start.width, start.height) || !allFinite(delta.x, delta.y)) {
    return { x: start.x, y: start.y, width: start.width, height: start.height };
  }
  let { x, y } = start;
  let width = handleMovesRight(handle) ? start.width + delta.x : start.width;
  if (handleMovesLeft(handle)) {
    x = start.x + delta.x;
    width = start.width - delta.x;
  }
  let height = handleMovesBottom(handle) ? start.height + delta.y : start.height;
  if (handleMovesTop(handle)) {
    y = start.y + delta.y;
    height = start.height - delta.y;
  }
  if (aspectLocked && start.width !== 0 && start.height !== 0) {
    const scaleX = width / start.width;
    const scaleY = height / start.height;
    // The axis the pointer moved further along decides, so the box follows the
    // hand instead of lagging on the axis nobody was aiming at.
    const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    if (isFiniteNumber(scale)) {
      width = start.width * scale;
      height = start.height * scale;
      if (handleMovesLeft(handle)) x = start.x + start.width - width;
      if (handleMovesTop(handle)) y = start.y + start.height - height;
    }
  }
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

/** The multiples of the starting scale that keep one axis inside its limits. */
interface ScaleLimits {
  readonly low: number;
  readonly high: number;
}

/**
 * The bounds for one axis: at least the largest multiple that keeps every object
 * on or above its own `minSizes` entry, at most the smallest that keeps every
 * object on or below `maxSize`. `sides[i]` and `minSizes[i]` describe the same
 * object; an object with no width says nothing about the width axis.
 */
function scaleLimits(sides: number[], minSizes: readonly number[], maxSize: number): ScaleLimits {
  let low = 0;
  let high = Number.POSITIVE_INFINITY;
  sides.forEach((side, index) => {
    if (!isFiniteNumber(side) || side <= 0) return;
    const min = minSizes[index] ?? minSizes[0] ?? 0;
    if (isFiniteNumber(min) && min > 0) low = Math.max(low, min / side);
    if (isFiniteNumber(maxSize) && maxSize > 0) high = Math.min(high, maxSize / side);
  });
  return { low, high };
}

/**
 * The scale to apply to a whole selection so that no object in it crosses a size
 * limit (`sel.size_limits`).
 *
 * A uniform scale stays uniform — one selection is resized as one piece, or a
 * note would stop being a square halfway through a drag — and is capped by
 * whichever object reaches its limit first, so the whole cluster stops there
 * together with its layout intact. A per-axis scale (an edge handle, which only
 * ever wanted one axis) is capped per axis instead. A scale that is not a
 * number, and limits that cannot both be honoured, leave everything alone:
 * scale 1 writes nothing.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  const NO_CHANGE: Point = { x: 1, y: 1 };
  if (!allFinite(scale.x, scale.y)) return NO_CHANGE;
  const onWidth = scaleLimits(
    rects.map((rect) => rect.width),
    minSizes,
    maxSize,
  );
  const onHeight = scaleLimits(
    rects.map((rect) => rect.height),
    minSizes,
    maxSize,
  );
  if (scale.x === scale.y) {
    // One scale for both axes, so both axes' tightest bound applies to it.
    const shared: ScaleLimits = {
      low: Math.max(onWidth.low, onHeight.low),
      high: Math.min(onWidth.high, onHeight.high),
    };
    if (shared.low > shared.high) return NO_CHANGE;
    const clamped = Math.min(Math.max(scale.x, shared.low), shared.high);
    return { x: clamped, y: clamped };
  }
  const perAxis = (requested: number, limits: ScaleLimits): number =>
    limits.low > limits.high ? 1 : Math.min(Math.max(requested, limits.low), limits.high);
  return { x: perAxis(scale.x, onWidth), y: perAxis(scale.y, onHeight) };
}

/**
 * Put `child` where it sat in `from` when `from` becomes `to`: position, size and
 * the gaps around it all scale, which is the whole of "the cluster keeps its
 * layout while it is resized". A box with nought width or height has nothing to
 * scale along that axis, so that axis is taken as scale 1 rather than dividing
 * by zero.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (
    !allFinite(from.x, from.y, from.width, from.height, to.x, to.y, to.width, to.height) ||
    !allFinite(child.x, child.y, child.width, child.height)
  ) {
    return { x: child.x, y: child.y, width: child.width, height: child.height };
  }
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
