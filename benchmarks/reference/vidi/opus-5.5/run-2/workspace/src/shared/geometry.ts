/**
 * Pure rectangle maths for selection, marquee and group resize (anchor: sel.geometry_ops).
 * All values are world units. Framework-free and side-effect free.
 */

export interface Point { readonly x: number; readonly y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HALF = 2;

/** True when `inner` lies entirely inside `outer` (touching edges counts as inside). */
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
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Rect spanned by two corner points in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function movesWest(h: Handle): boolean {
  return h === 'w' || h === 'nw' || h === 'sw';
}
function movesEast(h: Handle): boolean {
  return h === 'e' || h === 'ne' || h === 'se';
}
function movesNorth(h: Handle): boolean {
  return h === 'n' || h === 'ne' || h === 'nw';
}
function movesSouth(h: Handle): boolean {
  return h === 's' || h === 'se' || h === 'sw';
}

/**
 * The fixed point of a resize by `handle`: the opposite corner or edge. On the axis an
 * edge handle does not move, the anchor is the centre (matters only when aspect-locked).
 */
export function resizeAnchor(start: Rect, handle: Handle): Point {
  const x = movesWest(handle) ? start.x + start.width : movesEast(handle) ? start.x : start.x + start.width / HALF;
  const y = movesNorth(handle) ? start.y + start.height : movesSouth(handle) ? start.y : start.y + start.height / HALF;
  return { x, y };
}

/** `start` scaled by `scale` about the anchor of `handle`. */
export function applyScale(start: Rect, handle: Handle, scale: Point): Rect {
  const a = resizeAnchor(start, handle);
  return {
    x: a.x + (start.x - a.x) * scale.x,
    y: a.y + (start.y - a.y) * scale.y,
    width: start.width * scale.x,
    height: start.height * scale.y,
  };
}

function ratio(next: number, size: number): number {
  return size > 0 ? Math.max(0, next) / size : 1;
}

/** Scale factors a drag of `handle` by `delta` asks for (before any limits). */
export function resizeScale(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Point {
  const dw = movesEast(handle) ? delta.x : movesWest(handle) ? -delta.x : 0;
  const dh = movesSouth(handle) ? delta.y : movesNorth(handle) ? -delta.y : 0;
  const sx = movesEast(handle) || movesWest(handle) ? ratio(start.width + dw, start.width) : 1;
  const sy = movesNorth(handle) || movesSouth(handle) ? ratio(start.height + dh, start.height) : 1;
  if (!aspectLocked) return { x: sx, y: sy };
  const horizontal = movesEast(handle) || movesWest(handle);
  const vertical = movesNorth(handle) || movesSouth(handle);
  // Corners follow whichever axis the pointer moved further; edges follow their own axis.
  const s = horizontal && vertical ? (Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy) : horizontal ? sx : sy;
  return { x: s, y: s };
}

/**
 * Resizes `start` by dragging `handle` by `delta`, from the opposite corner or edge.
 * Edge handles change one axis; corners both. With `aspectLocked` the ratio is kept.
 * Sizes never go below 0 (no flipping).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  return applyScale(start, handle, resizeScale(start, handle, delta, aspectLocked));
}

/** Allowed scale range [lo, hi] for one axis; the current size (scale 1) always stays allowed. */
function axisRange(sizes: readonly number[], minSizes: readonly number[], maxSize: number): [number, number] {
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  sizes.forEach((size, i) => {
    if (!(size > 0)) return;
    lo = Math.max(lo, (minSizes[i] ?? 0) / size);
    hi = Math.min(hi, maxSize / size);
  });
  // An object already outside its limits (e.g. written elsewhere) never forces a change.
  return [Math.min(lo, 1), Math.max(hi, 1)];
}

function clampTo(value: number, [lo, hi]: [number, number]): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Clamps a group scale so that no rect gets smaller than its `minSizes[i]` or larger than
 * `maxSize` on either axis. The whole group stops at the scale where the first object
 * reaches a limit. Equal x/y scales (aspect-locked) stay equal.
 */
export function clampScale(scale: Point, rects: readonly Rect[], minSizes: readonly number[], maxSize: number): Point {
  const rx = axisRange(rects.map((r) => r.width), minSizes, maxSize);
  const ry = axisRange(rects.map((r) => r.height), minSizes, maxSize);
  if (scale.x === scale.y) {
    const s = clampTo(scale.x, [Math.max(rx[0], ry[0]), Math.min(rx[1], ry[1])]);
    return { x: s, y: s };
  }
  return { x: clampTo(scale.x, rx), y: clampTo(scale.y, ry) };
}

/** Maps `child` from the box `from` into the box `to` (position and size scale together). */
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
