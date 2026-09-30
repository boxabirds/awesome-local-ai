// Pure rectangle maths for selection, marquee and group resize. World units; no DOM.

export interface Point { readonly x: number; readonly y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function isFiniteRect(r: Rect): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite);
}

/** True when every edge of `inner` lies inside (or on) `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect containing all `rects`; null for none. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The rect spanned by two corner points, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function movesX(handle: Handle): boolean {
  return handle.includes('e') || handle.includes('w');
}

function movesY(handle: Handle): boolean {
  return handle.includes('n') || handle.includes('s');
}

/**
 * Scales `start` by `scale` keeping the side (or corner) opposite `handle` fixed.
 * On an axis the handle does not move, the rect's centre stays fixed.
 */
export function scaleFromHandle(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  const x = handle.includes('w')
    ? start.x + start.width - width
    : handle.includes('e')
      ? start.x
      : start.x + (start.width - width) / 2;
  const y = handle.includes('n')
    ? start.y + start.height - height
    : handle.includes('s')
      ? start.y
      : start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

/**
 * The rect after dragging `handle` by `delta` from `start`. Edge handles change one
 * axis, corner handles both. With `aspectLocked` the width-to-height ratio is kept
 * (the axis that changed more wins) and the opposite side or corner stays put.
 * Sizes never go below 0 (limits are applied by `clampScale`).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width += delta.x;
  if (handle.includes('w')) width -= delta.x;
  if (handle.includes('s')) height += delta.y;
  if (handle.includes('n')) height -= delta.y;
  width = Math.max(0, width);
  height = Math.max(0, height);
  if (!aspectLocked || start.width <= 0 || start.height <= 0) {
    const x = handle.includes('w') ? start.x + start.width - width : start.x;
    const y = handle.includes('n') ? start.y + start.height - height : start.y;
    return { x, y, width, height };
  }
  const sx = width / start.width;
  const sy = height / start.height;
  let s: number;
  if (movesX(handle) && movesY(handle)) s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
  else s = movesX(handle) ? sx : sy;
  return scaleFromHandle(start, handle, { x: s, y: s });
}

function clampRange(value: number, lo: number, hi: number): number {
  if (lo > hi) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Clamps a per-axis scale so that no rect's width or height goes below its own
 * minimum or above `maxSize`. One scale is returned for the whole selection, so
 * it stops as soon as the first object reaches a limit. With `uniform` (default:
 * x === y) the result keeps x === y, so proportions are preserved.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
  uniform = scale.x === scale.y,
): Point {
  let loX = 0;
  let hiX = Infinity;
  let loY = 0;
  let hiY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      loX = Math.max(loX, min / r.width);
      hiX = Math.min(hiX, maxSize / r.width);
    }
    if (r.height > 0) {
      loY = Math.max(loY, min / r.height);
      hiY = Math.min(hiY, maxSize / r.height);
    }
  });
  if (uniform) {
    const s = clampRange(scale.x, Math.max(loX, loY), Math.min(hiX, hiY));
    return { x: s, y: s };
  }
  return { x: clampRange(scale.x, loX, hiX), y: clampRange(scale.y, loY, hiY) };
}

/** Maps `child` from the frame `from` into the frame `to` (position and size scale together). */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
