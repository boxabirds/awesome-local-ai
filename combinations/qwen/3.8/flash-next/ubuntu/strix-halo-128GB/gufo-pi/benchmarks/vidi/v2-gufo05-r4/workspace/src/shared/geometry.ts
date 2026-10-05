/**
 * Pure rectangle maths for selecting and transforming board objects (story 7).
 *
 * Everything here works in world units and knows nothing about Yjs, React or the
 * DOM, so the same maths answers "is this object inside the marquee?", "how big is
 * the bounding box of this selection?" and "where does this object go when the box
 * it sits in is resized?" wherever the answer is needed.
 *
 * The resize rules the product asks for, in the order they are applied:
 *  1. `resizeRect` turns a handle, a pointer delta and an aspect-lock flag into the
 *     box the pointer is asking for, anchored on the opposite corner or edge;
 *  2. `clampScale` pulls that request back to the largest (or smallest) scale at
 *     which no selected object crosses its type's minimum size or the global
 *     maximum, so the whole selection stops where its *first* object does;
 *  3. `scaleWithin` places one object inside the resulting box, which is what keeps
 *     a cluster's layout — sizes and gaps alike — proportional to the box.
 */

/** A rectangle in world units: top-left corner plus size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One of the eight resize handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * Which way a handle drives each axis: `1` moves the far edge, `-1` the near edge
 * and `0` leaves that axis alone (an edge handle on the other axis).
 */
function handleAxes(handle: Handle): { xs: -1 | 0 | 1; ys: -1 | 0 | 1 } {
  const xs: -1 | 0 | 1 = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const ys: -1 | 0 | 1 = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  return { xs, ys };
}

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidRect(rect: Rect | null | undefined): rect is Rect {
  return (
    !!rect &&
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Does `outer` hold `inner` completely? Touching an edge counts as inside — an
 * object is only left out when part of it hangs over (`sel.marquee`).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isValidRect(outer) || !isValidRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rectangle holding every one of `rects`, or null when there is
 * nothing to bound (an empty selection has no box, no handles and no bar).
 * Rectangles that are not numbers are left out rather than poisoning the result.
 */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (!isValidRect(rect)) continue;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!isFiniteNumber(minX) || !isFiniteNumber(maxX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Two opposite corners of a dragged rectangle, in any order, as a real rectangle. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  return { x: x1, y: y1, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * The box a handle dragged by `delta` asks for, growing or shrinking from the
 * opposite corner or edge (which never moves).
 *
 * With `aspectLocked` the width-to-height ratio of `start` is kept: a corner handle
 * follows whichever axis the pointer moved further along, and an edge handle scales
 * both axes by the axis it drives, centred on the other. Non-finite input returns
 * `start` unchanged, so a bogus pointer event cannot shrink a note out of existence.
 */
/**
 * The scale a dragged handle asks for, as a ratio of `start`.
 *
 * This is the quantity a *group* resize needs: one scale for a whole bounding box,
 * which is then clamped against the objects inside it and applied to each of them.
 * When the aspect is locked both parts are literally the same number, so a caller can
 * tell a uniform request from a free one by comparing them.
 */
export function resizeScale(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Point {
  if (!isValidRect(start) || start.width <= 0 || start.height <= 0) return { x: 1, y: 1 };
  if (!delta || !isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) return { x: 1, y: 1 };
  const { xs, ys } = handleAxes(handle);
  // A handle can be dragged past the opposite edge, which would turn the box inside
  // out; the box stops just short of that instead.
  const MIN_RATIO = 1e-6;
  const ratioFor = (axis: -1 | 0 | 1, size: number, move: number): number =>
    axis === 0 ? 1 : Math.max((axis === 1 ? size + move : size - move) / size, MIN_RATIO);
  const sx = ratioFor(xs, start.width, delta.x);
  const sy = ratioFor(ys, start.height, delta.y);
  if (!aspectLocked) return { x: sx, y: sy };

  // One ratio for both axes, taken from the axis this handle drives. A corner
  // follows the axis the pointer moved further along.
  const driven = [xs !== 0 ? sx : null, ys !== 0 ? sy : null].filter((value): value is number => value !== null);
  const uniform = driven.length > 0 ? Math.max(...driven) : 1;
  return { x: uniform, y: uniform };
}

/**
 * The box a handle dragged by `delta` asks for. An axis the handle drives keeps the
 * edge *farthest* from the handle where it was, and an axis it does not drive is left
 * alone; with the aspect locked, `anchorScaleRect` supplies the ratio to both.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!isValidRect(start) || start.width <= 0 || start.height <= 0) return start;
  if (!delta || !isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) return start;
  const { xs, ys } = handleAxes(handle);
  if (aspectLocked) return anchorScaleRect(start, handle, resizeScale(start, handle, delta, true));

  // Worked out as lengths rather than as a scale factor, so a drag of 20 units changes
  // a side by exactly 20 rather than by 20.000000000000004 through a divide-and-
  // multiply round trip. The far-from-handle edge stays put.
  const MIN_SIZE = 1e-6;
  return {
    x: xs === -1 ? start.x + delta.x : start.x,
    y: ys === -1 ? start.y + delta.y : start.y,
    width: Math.max(xs === 1 ? start.width + delta.x : xs === -1 ? start.width - delta.x : start.width, MIN_SIZE),
    height: Math.max(ys === 1 ? start.height + delta.y : ys === -1 ? start.height - delta.y : start.height, MIN_SIZE)
  };
}

/**
 * The box `start` scaled by `scale`, anchored the way `handle` implies: an axis the
 * handle drives keeps its far-from-handle edge fixed, and an axis it does not drive
 * is scaled about the middle. `resizeRect` is this function with the scale worked
 * out from a pointer delta, so the two can never disagree about where the anchor is.
 */
export function anchorScaleRect(start: Rect, handle: Handle, scale: Point): Rect {
  if (!isValidRect(start) || !scale || !isFiniteNumber(scale.x) || !isFiniteNumber(scale.y)) return start;
  const { xs, ys } = handleAxes(handle);
  const width = Math.max(start.width * scale.x, 0);
  const height = Math.max(start.height * scale.y, 0);
  let x: number;
  if (xs === 1) x = start.x;
  else if (xs === -1) x = start.x + start.width - width;
  else x = start.x + (start.width - width) / 2;
  let y: number;
  if (ys === 1) y = start.y;
  else if (ys === -1) y = start.y + start.height - height;
  else y = start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

/**
 * The one scale a whole selection may apply, given where its objects are.
 *
 * Each axis is kept between the smallest scale at which no object drops below its
 * type's `minSizes` entry and the largest at which none passes `maxSize`. A uniform
 * candidate (both parts equal, which is what an aspect-locked resize asks for) is
 * clamped uniformly, so the selection keeps its proportions and stops as one piece
 * at the first limit its first object reaches. A scale of 1 is always allowed, so a
 * call can never be the reason an object jumps.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (!scale || !isFiniteNumber(scale.x) || !isFiniteNumber(scale.y)) return { x: 1, y: 1 };
  let loX = 0;
  let loY = 0;
  let hiX = Number.POSITIVE_INFINITY;
  let hiY = Number.POSITIVE_INFINITY;
  rects.forEach((candidate, index) => {
    if (!isValidRect(candidate) || candidate.width <= 0 || candidate.height <= 0) return;
    const min = isFiniteNumber(minSizes[index] ?? NaN) && minSizes[index]! > 0 ? minSizes[index]! : 0;
    loX = Math.max(loX, min / candidate.width);
    loY = Math.max(loY, min / candidate.height);
    if (isFiniteNumber(maxSize) && maxSize > 0) {
      hiX = Math.min(hiX, maxSize / candidate.width);
      hiY = Math.min(hiY, maxSize / candidate.height);
    }
  });
  // "Leave it alone" must always be inside the allowed range, even for an object that
  // is already past a limit (a note made before the limits existed, say).
  loX = Math.min(loX, 1);
  loY = Math.min(loY, 1);
  hiX = Math.max(hiX, 1);
  hiY = Math.max(hiY, 1);

  if (scale.x === scale.y) {
    const uniform = clamp(scale.x, Math.max(loX, loY), Math.min(hiX, hiY));
    return { x: uniform, y: uniform };
  }
  return { x: clamp(scale.x, loX, hiX), y: clamp(scale.y, loY, hiY) };
}

/**
 * Where `child` lands when the box it sits in (`from`) becomes `to`: position and
 * size scaled by the box, which is what makes a group resize proportional — a note
 * twice as wide in a box twice as wide, and the gap between two notes twice as wide
 * too (`sel.resize`).
 *
 * A box with no width or height cannot be scaled into (a brand-new marquee, a note
 * squashed flat by hand), and `child` is returned untouched rather than divided by
 * zero.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isValidRect(child) || !isValidRect(from) || !isValidRect(to)) return child;
  if (from.width <= 0 || from.height <= 0) return child;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy
  };
}
