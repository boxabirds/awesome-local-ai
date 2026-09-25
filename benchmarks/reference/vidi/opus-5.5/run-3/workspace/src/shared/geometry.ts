// Pure rectangle maths for selection, marquee and group resize. World units throughout; no DOM or Yjs.

export interface Point { readonly x: number; readonly y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Whether `inner` lies entirely inside `outer` (touching edges count as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect containing every rect; null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rect spanned by two corner points, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function movesLeft(h: Handle): boolean {
  return h === 'w' || h === 'nw' || h === 'sw';
}
function movesRight(h: Handle): boolean {
  return h === 'e' || h === 'ne' || h === 'se';
}
function movesTop(h: Handle): boolean {
  return h === 'n' || h === 'nw' || h === 'ne';
}
function movesBottom(h: Handle): boolean {
  return h === 's' || h === 'sw' || h === 'se';
}

/**
 * The point that stays put while `handle` is dragged: the opposite corner or edge. On an axis the handle does
 * not move, the anchor is the centre (used when an edge handle resizes with the aspect ratio kept).
 */
export function handleAnchor(start: Rect, handle: Handle): Point {
  const x = movesLeft(handle) ? start.x + start.width : movesRight(handle) ? start.x : start.x + start.width / 2;
  const y = movesTop(handle) ? start.y + start.height : movesBottom(handle) ? start.y : start.y + start.height / 2;
  return { x, y };
}

/**
 * Scale factors from dragging `handle` of `start` by world `delta`. Never negative (no flipping).
 * With `aspectLocked` both factors are equal: corners follow the axis that moved further, edges their own axis.
 */
export function handleScale(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Point {
  const ratio = (size: number, change: number) => (size > 0 ? Math.max(0, (size + change) / size) : 1);
  let sx = movesRight(handle) ? ratio(start.width, delta.x) : movesLeft(handle) ? ratio(start.width, -delta.x) : 1;
  let sy = movesBottom(handle) ? ratio(start.height, delta.y) : movesTop(handle) ? ratio(start.height, -delta.y) : 1;
  if (aspectLocked) {
    const horizontal = movesLeft(handle) || movesRight(handle);
    const vertical = movesTop(handle) || movesBottom(handle);
    const s = horizontal && vertical ? (Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy) : horizontal ? sx : sy;
    sx = s;
    sy = s;
  }
  return { x: sx, y: sy };
}

/** `start` scaled by `scale` about the anchor of `handle`. */
export function scaleFromHandle(start: Rect, handle: Handle, scale: Point): Rect {
  const a = handleAnchor(start, handle);
  return {
    x: a.x + (start.x - a.x) * scale.x,
    y: a.y + (start.y - a.y) * scale.y,
    width: start.width * scale.x,
    height: start.height * scale.y,
  };
}

/**
 * The rect after dragging `handle` by `delta`: edge handles change one axis, corners both, from the opposite
 * corner or edge. `aspectLocked` keeps the width-to-height ratio.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  return scaleFromHandle(start, handle, handleScale(start, handle, delta, aspectLocked));
}

/**
 * Clamps a group scale so that no rect gets a side below its `minSizes[i]` or above `maxSize`. The same factor
 * applies to every rect, so the whole group stops as soon as the first rect reaches a limit. When
 * `scale.x === scale.y` (aspect kept) the result is uniform too. An axis with factor 1 is left alone. A side that
 * is already below its minimum (story 11: a thin straight pen stroke) may not shrink further but is not forced to
 * grow.
 */
export function clampScale(scale: Point, rects: readonly Rect[], minSizes: readonly number[], maxSize: number): Point {
  const range = (size: (r: Rect) => number) => {
    let lo = 0;
    let hi = Infinity;
    rects.forEach((r, i) => {
      const s = size(r);
      if (!(s > 0)) return;
      lo = Math.max(lo, Math.min(1, (minSizes[i] ?? 0) / s));
      hi = Math.min(hi, maxSize / s);
    });
    return { lo, hi: Math.max(lo, hi) };
  };
  const clamp = (v: number, r: { lo: number; hi: number }) => Math.min(r.hi, Math.max(r.lo, v));
  const rx = range((r) => r.width);
  const ry = range((r) => r.height);
  if (scale.x === scale.y) {
    if (scale.x === 1) return scale;
    const both = { lo: Math.max(rx.lo, ry.lo), hi: Math.max(Math.max(rx.lo, ry.lo), Math.min(rx.hi, ry.hi)) };
    const s = clamp(scale.x, both);
    return { x: s, y: s };
  }
  return { x: scale.x === 1 ? 1 : clamp(scale.x, rx), y: scale.y === 1 ? 1 : clamp(scale.y, ry) };
}

/** Where `child` goes when its container `from` becomes `to`: position and size scale proportionally. */
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
