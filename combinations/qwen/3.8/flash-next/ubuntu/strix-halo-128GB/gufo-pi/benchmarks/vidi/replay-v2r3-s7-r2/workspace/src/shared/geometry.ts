/**
 * Pure rectangle maths (story 7).
 *
 * Everything here works in world (board) units and has no knowledge of Yjs or
 * React, so the marquee containment rule, the group resize maths and the size
 * limits can be unit-tested on their own.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Screen-reader names of the handles, e.g. `aria-label="Resize top-left"`. */
export const HANDLE_NAMES: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** Cursor for each handle, in screen space. */
export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Below this edge length a rect is treated as degenerate. */
const MIN_EDGE = 1e-6;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isFinitePointValue(p: unknown): p is Point {
  return !!p && isFiniteNumber((p as Point).x) && isFiniteNumber((p as Point).y);
}

export function isFiniteRect(r: unknown): r is Rect {
  if (!r) return false;
  const rect = r as Rect;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

/** True when every edge of `inner` lies inside `outer` (touching counts as in). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect holding every argument, or null when there is none. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const r of rects) {
    if (!isFiniteRect(r)) continue;
    count += 1;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The axis-aligned rect between two (screen or world) points. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!isFinitePointValue(a) || !isFinitePointValue(b)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function movesLeft(handle: Handle): boolean {
  return handle.includes('w');
}
function movesRight(handle: Handle): boolean {
  return handle.includes('e');
}
function movesTop(handle: Handle): boolean {
  return handle.includes('n');
}
function movesBottom(handle: Handle): boolean {
  return handle.includes('s');
}

/**
 * Places a box of `width` x `height` so that the edge or corner *opposite* to
 * `handle` stays where it is. For an aspect-locked edge handle the box grows
 * across the axis it does not move about its centre.
 */
export function anchoredRect(
  start: Rect,
  handle: Handle,
  width: number,
  height: number,
  aspectLocked: boolean,
): Rect {
  const left = movesLeft(handle);
  const top = movesTop(handle);
  const horizontalOnly = (movesLeft(handle) || movesRight(handle)) && !movesTop(handle) && !movesBottom(handle);
  const verticalOnly = (movesTop(handle) || movesBottom(handle)) && !movesLeft(handle) && !movesRight(handle);

  let x = left ? start.x + start.width - width : start.x;
  let y = top ? start.y + start.height - height : start.y;
  if (aspectLocked && horizontalOnly) y = start.y + (start.height - height) / 2;
  if (aspectLocked && verticalOnly) x = start.x + (start.width - width) / 2;
  return { x, y, width, height };
}

/**
 * Drag `handle` of `start` by `delta` (world units) and return the new box.
 * Edge handles change one axis, corner handles both. With `aspectLocked` the
 * width-to-height ratio of `start` is kept, following the axis the pointer
 * moved along further.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isFiniteRect(start) || !isFinitePointValue(delta)) return { ...start };
  if (!(start.width > 0) || !(start.height > 0)) return { ...start };

  let width = start.width;
  let height = start.height;
  if (movesRight(handle)) width += delta.x;
  else if (movesLeft(handle)) width -= delta.x;
  if (movesBottom(handle)) height += delta.y;
  else if (movesTop(handle)) height -= delta.y;

  width = Math.max(MIN_EDGE, width);
  height = Math.max(MIN_EDGE, height);

  if (aspectLocked) {
    const ratio = start.width / start.height;
    const horizontal = movesLeft(handle) || movesRight(handle);
    const vertical = movesTop(handle) || movesBottom(handle);
    if (horizontal && vertical) {
      // Follow whichever axis the pointer moved along further.
      const dw = Math.abs(width - start.width) / start.width;
      const dh = Math.abs(height - start.height) / start.height;
      if (dw >= dh) height = width / ratio;
      else width = height * ratio;
    } else if (horizontal) {
      height = width / ratio;
    } else if (vertical) {
      width = height * ratio;
    }
  }

  return anchoredRect(start, handle, width, height, aspectLocked);
}

/**
 * The single scale factor pair that keeps every rect within its own `minSizes`
 * entry and within `maxSize` on both axes. Because the same pair is applied to
 * the whole selection, the group stops as soon as its first object reaches a
 * limit, and the relative layout is untouched.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let lowX = 0;
  let highX = Number.POSITIVE_INFINITY;
  let lowY = 0;
  let highY = Number.POSITIVE_INFINITY;

  rects.forEach((rect, i) => {
    if (!isFiniteRect(rect) || !(rect.width > 0) || !(rect.height > 0)) return;
    const min = isFiniteNumber(minSizes[i]) && minSizes[i] > 0 ? minSizes[i] : 0;
    if (min > lowX) lowX = min / rect.width;
    if (min > lowY) lowY = min / rect.height;
    if (isFiniteNumber(maxSize) && maxSize > 0) {
      const maxX = maxSize / rect.width;
      const maxY = maxSize / rect.height;
      if (maxX < highX) highX = maxX;
      if (maxY < highY) highY = maxY;
    }
  });

  const clampAxis = (value: number, low: number, high: number): number => {
    const lo = Math.max(low, 0);
    const fallback = 1 < lo ? lo : Number.isFinite(high) ? Math.min(1, high) : lo;
    if (!isFiniteNumber(value)) return fallback;
    let out = value;
    if (out < lo) out = lo;
    if (out > high) out = high;
    if (out < lo) out = fallback; // only reachable when min > max
    return out;
  };

  return { x: clampAxis(scale.x, lowX, highX), y: clampAxis(scale.y, lowY, highY) };
}

/**
 * Map `child` from the box `from` into the box `to`, keeping its relative
 * position and scaling its size — the layout of a group resize.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(child) || !isFiniteRect(from) || !isFiniteRect(to)) return { ...child };
  if (!(from.width > 0) || !(from.height > 0)) return { ...child };
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
