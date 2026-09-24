/**
 * Pure rectangle maths for selection, marquee and resize (story 7). World units throughout.
 * No DOM, no React, no Yjs.
 */

export interface Point { readonly x: number; readonly y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, clockwise from the top-left corner (render order). */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HALF = 2;
const IDENTITY: Point = { x: 1, y: 1 };

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/** True when `inner` lies entirely inside `outer` (touching edges counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect containing every rect, or null for an empty list. */
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

/** The rect spanned by two opposite corners, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
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
function isCorner(h: Handle): boolean {
  return h.length === 2;
}

/**
 * `start` scaled by `scale` about the edge or corner opposite `handle`. An axis the handle does
 * not move (e.g. y for 'e') is scaled about the rect's centre on that axis.
 */
export function anchoredRect(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
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

/** Scale factor per axis that turns `start` into `to` (1 on an axis of zero size). */
export function scaleBetween(start: Rect, to: Rect): Point {
  return {
    x: start.width > 0 ? to.width / start.width : 1,
    y: start.height > 0 ? to.height / start.height : 1,
  };
}

/**
 * `start` after dragging `handle` by `delta`: edge handles change one dimension, corner handles
 * both; the opposite edge/corner stays put. Sizes never go below zero (no flipping). With
 * `aspectLocked` the width-to-height ratio is kept: corners follow the axis dragged furthest,
 * edge handles scale the other dimension about its centre.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!finite(delta.x, delta.y)) return { ...start };
  let width = start.width;
  let height = start.height;
  if (movesRight(handle)) width += delta.x;
  if (movesLeft(handle)) width -= delta.x;
  if (movesBottom(handle)) height += delta.y;
  if (movesTop(handle)) height -= delta.y;
  const raw = scaleBetween(start, { ...start, width: Math.max(0, width), height: Math.max(0, height) });
  let scale = raw;
  if (aspectLocked) {
    let s: number;
    if (!isCorner(handle)) s = movesLeft(handle) || movesRight(handle) ? raw.x : raw.y;
    else s = Math.abs(raw.x - 1) >= Math.abs(raw.y - 1) ? raw.x : raw.y;
    scale = { x: s, y: s };
  }
  return anchoredRect(start, handle, scale);
}

/** [low, high] scale range on one axis for sizes `sizes` with per-object minimum `mins`. */
function axisRange(sizes: readonly number[], mins: readonly number[], maxSize: number): [number, number] {
  let lo = 0;
  let hi = Infinity;
  sizes.forEach((size, i) => {
    if (!(size > 0)) return;
    // An object already outside its limits may not move further out, but is not forced back in.
    lo = Math.max(lo, Math.min(1, (mins[i] ?? 0) / size));
    hi = Math.min(hi, Math.max(1, maxSize / size));
  });
  return [lo, hi];
}

function clampTo(value: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Clamps a resize scale so that no rect gets smaller than its minimum size (`minSizes[i]`, both
 * dimensions) or larger than `maxSize`. A uniform scale (x === y) stays uniform and stops at the
 * first object to reach a limit, so the whole selection keeps its layout; a one-axis or free
 * scale is clamped per axis. Non-finite or negative input gives no change (1, 1).
 */
export function clampScale(scale: Point, rects: readonly Rect[], minSizes: readonly number[], maxSize: number): Point {
  if (!finite(scale.x, scale.y) || scale.x < 0 || scale.y < 0) return IDENTITY;
  const xRange = axisRange(
    rects.map((r) => r.width),
    minSizes,
    maxSize,
  );
  const yRange = axisRange(
    rects.map((r) => r.height),
    minSizes,
    maxSize,
  );
  if (scale.x === scale.y) {
    const both: [number, number] = [Math.max(xRange[0], yRange[0]), Math.min(xRange[1], yRange[1])];
    const s = clampTo(scale.x, both);
    return { x: s, y: s };
  }
  return { x: clampTo(scale.x, xRange), y: clampTo(scale.y, yRange) };
}

/** `child`'s rect after its container `from` became `to`: position and size scale together. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const s = scaleBetween(from, to);
  return {
    x: to.x + (child.x - from.x) * s.x,
    y: to.y + (child.y - from.y) * s.y,
    width: child.width * s.x,
    height: child.height * s.y,
  };
}
