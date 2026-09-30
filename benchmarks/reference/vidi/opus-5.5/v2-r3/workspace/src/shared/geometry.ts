// Pure rectangle maths for selection, marquee and resize (story 7). World units.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HALF = 2;

export function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height)
  );
}

/** True when every edge of `inner` lies inside `outer` (edges may coincide). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect containing all `rects`; null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
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

/** The rect spanned by two corner points, in either order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
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
function changesWidth(h: Handle): boolean {
  return movesLeft(h) || movesRight(h);
}
function changesHeight(h: Handle): boolean {
  return movesTop(h) || movesBottom(h);
}

/**
 * Rescales `start` by `scale` keeping the side/corner opposite `handle` fixed.
 * An axis the handle does not drag stays centred on its original middle.
 */
export function scaleRectFrom(start: Rect, handle: Handle, scale: Point): Rect {
  return sizeRectFrom(start, handle, start.width * scale.x, start.height * scale.y);
}

function sizeRectFrom(start: Rect, handle: Handle, width: number, height: number): Rect {
  let x: number;
  if (movesLeft(handle)) x = start.x + start.width - width;
  else if (movesRight(handle)) x = start.x;
  else x = start.x + (start.width - width) / HALF;
  let y: number;
  if (movesTop(handle)) y = start.y + start.height - height;
  else if (movesBottom(handle)) y = start.y;
  else y = start.y + (start.height - height) / HALF;
  return { x, y, width, height };
}

/**
 * The rect after dragging `handle` by `delta` (world units), anchored at the
 * opposite corner or edge. Sizes never go below zero (no flipping). With
 * `aspectLocked` the width-to-height ratio of `start` is kept: corners follow
 * the axis that grew most, edges scale the other axis about its centre.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  if (movesRight(handle)) width = start.width + delta.x;
  if (movesLeft(handle)) width = start.width - delta.x;
  if (movesBottom(handle)) height = start.height + delta.y;
  if (movesTop(handle)) height = start.height - delta.y;
  width = Math.max(0, width);
  height = Math.max(0, height);
  if (!aspectLocked) return sizeRectFrom(start, handle, width, height);
  const sx = start.width > 0 ? width / start.width : 1;
  const sy = start.height > 0 ? height / start.height : 1;
  let s: number;
  if (changesWidth(handle) && changesHeight(handle)) s = Math.max(sx, sy);
  else if (changesWidth(handle)) s = sx;
  else s = sy;
  return scaleRectFrom(start, handle, { x: s, y: s });
}

/**
 * Clamps a resize scale so that no rect gets smaller than its minimum size or
 * larger than `maxSize` on either axis. One scale for all rects, so the whole
 * selection stops when the first object reaches a limit and the layout is kept.
 * A uniform (aspect-kept) scale stays uniform. Objects already outside a limit
 * are never pushed further past it, nor forced back into range.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
  uniform: boolean = scale.x === scale.y,
): Point {
  const range = (sizes: number[], mins: number[]): [number, number] => {
    let lo = 0;
    let hi = Infinity;
    sizes.forEach((size, i) => {
      if (!(size > 0)) return;
      lo = Math.max(lo, mins[i] / size);
      hi = Math.min(hi, maxSize / size);
    });
    // Never force growth/shrink of an object already beyond a limit.
    return [Math.min(lo, 1), Math.max(hi, 1)];
  };
  const mins = rects.map((_, i) => minSizes[i] ?? 0);
  const [xLo, xHi] = range(
    rects.map((r) => r.width),
    mins,
  );
  const [yLo, yHi] = range(
    rects.map((r) => r.height),
    mins,
  );
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (uniform) {
    const lo = Math.max(xLo, yLo);
    const hi = Math.min(xHi, yHi);
    const s = clamp(scale.x, Math.min(lo, hi), Math.max(lo, hi));
    return { x: s, y: s };
  }
  return { x: clamp(scale.x, xLo, xHi), y: clamp(scale.y, yLo, yHi) };
}

/** Maps `child` from the box `from` to the box `to` (position and size scale together). */
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
