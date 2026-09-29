// Pure geometry for board objects (design `sel.geometry_ops`): axis-aligned
// rects, the marquee containment rule, and the maths behind resizing a whole
// selection from one handle.
//
// Everything here is in world (board) units and free of DOM, React and Yjs, so
// the same maths runs in the client and in a unit test.
//
// Conventions:
//  - A Rect is an axis-aligned box: (x, y) is its top-left corner.
//  - A resize is described by the handle being dragged and the pointer's delta.
//    The opposite corner or edge is the anchor: it never moves.

import { clamp } from './config.ts';

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

/** The eight resize handles of a bounding box, in clockwise order from top. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order a selection overlay should render them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Screen-reader names for the handles, e.g. `aria-label="Resize top-left"`. */
export const HANDLE_LABELS: Readonly<Record<Handle, string>> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** CSS resize cursor for a handle. */
export const HANDLE_CURSORS: Readonly<Record<Handle, string>> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function finiteRect(r: Rect | null | undefined): r is Rect {
  return !!r && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height);
}

function finitePoint(p: Point | null | undefined): p is Point {
  return !!p && finite(p.x) && finite(p.y);
}

/** True when the handle touches the east / west edge. */
export function handleEast(h: Handle): boolean {
  return h.includes('e');
}
export function handleWest(h: Handle): boolean {
  return h.includes('w');
}
export function handleSouth(h: Handle): boolean {
  return h.includes('s');
}
export function handleNorth(h: Handle): boolean {
  return h.includes('n');
}

/**
 * True when `inner` lies entirely inside `outer`. Touching edges count as
 * inside (the marquee's rule: an object the rectangle merely touches but does
 * not enclose is NOT selected, which is a strict *extent* test, not a centre
 * test). Non-finite input is never contained.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finiteRect(outer) || !finiteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rect enclosing every finite rect, or null for an empty (or
 * entirely unusable) list.
 */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let found = false;
  for (const r of rects) {
    if (!finiteRect(r)) continue;
    found = true;
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.width > x1) x1 = r.x + r.width;
    if (r.y + r.height > y1) y1 = r.y + r.height;
  }
  if (!found) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The rect spanned by two opposite corners, in any order — the marquee drag's
 * rectangle, so a drag upwards or leftwards still produces a positive rect.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finitePoint(a) || !finitePoint(b)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * The bounding box after dragging `handle` by `delta`, keeping the opposite
 * corner or edge fixed. Edge handles change one axis, corner handles both.
 *
 * With `aspectLocked` the box keeps the *start* box's width-to-height ratio:
 * the axis dragged further (the dominant one) decides the scale, so dragging a
 * sticky note's corner outwards by (100, 40) grows it to 300x300, not 300x240.
 *
 * The result is the *requested* box and may break a size limit; the caller
 * clamps it with `clampScale`. Non-finite input returns the start box.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!finiteRect(start) || !finitePoint(delta)) return { ...start };
  const east = handleEast(handle);
  const west = handleWest(handle);
  const south = handleSouth(handle);
  const north = handleNorth(handle);

  let width = start.width;
  let height = start.height;
  if (east) width += delta.x;
  if (west) width -= delta.x;
  if (south) height += delta.y;
  if (north) height -= delta.y;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const sx = width / start.width;
    const sy = height / start.height;
    // Dominant axis: whichever was dragged further from 1.
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    width = start.width * s;
    height = start.height * s;
  }

  // The anchor never moves: the opposite corner for corners, the opposite edge
  // for edges (the other axis is untouched there anyway).
  let x = start.x;
  let y = start.y;
  if (west) x = start.x + start.width - width;
  if (north) y = start.y + start.height - height;
  return { x, y, width, height };
}

/**
 * Clamp a requested per-axis scale so that no object crosses its own size
 * limits: every object keeps at least its `minSizes[i]` on both axes and at
 * most `maxSize`. The returned scale is applied to *every* object in the
 * selection, which is what keeps their relative layout intact — objects must
 * not stop at different times (design Key decision 2).
 *
 * When the request is uniform (a scale, as an aspect-locked selection always
 * is) the result is uniform too and stops at the *first* limit hit, so an
 * aspect-locked selection shrinks/grows as one.
 *
 * `uniform` says so out loud, which is not the same as working it out: the
 * factors an aspect-locked resize produces come from `(w * s) / w` and `(h * s) / h`,
 * and those are equal in arithmetic and only very nearly equal in floating point.
 * A caller that locked the aspect knows the request is one scale, and says so —
 * otherwise a picture dragged past the floor of one of its own sides is clamped on
 * that side alone, and the square that comes out the other end is a picture squashed
 * by the rounding of a number nobody meant to compare.
 *
 * A non-finite request returns the neutral scale {x: 1, y: 1}; a rect that is
 * not usable is skipped rather than clamping anybody.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
  uniform = false,
): Point {
  if (!finitePoint(scale) || !finite(maxSize) || maxSize <= 0) return { x: 1, y: 1 };
  let loX = 0;
  let hiX = Infinity;
  let loY = 0;
  let hiY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!finiteRect(r) || r.width <= 0 || r.height <= 0) continue;
    const min = finite(minSizes[i]) && minSizes[i] > 0 ? (minSizes[i] as number) : 0;
    // Smallest usable factor on this axis: the side must not go under `min`.
    loX = Math.max(loX, min / r.width);
    loY = Math.max(loY, min / r.height);
    // Largest usable factor: the side must not go over `maxSize`.
    hiX = Math.min(hiX, maxSize / r.width);
    hiY = Math.min(hiY, maxSize / r.height);
  }
  const sx = hiX < loX ? 1 : clamp(scale.x, loX, hiX);
  const sy = hiY < loY ? 1 : clamp(scale.y, loY, hiY);
  const requestedUniform = uniform || scale.x === scale.y;
  if (!requestedUniform) return { x: sx, y: sy };
  // A uniform request stays uniform and stops at whichever limit bit first
  // (the factor closest to 1).
  const f = Math.abs(sx - 1) <= Math.abs(sy - 1) ? sx : sy;
  return { x: f, y: f };
}

/**
 * Map `child` from the `from` box into the `to` box: position and size scale by
 * the box's own factors, so a selection's layout is preserved exactly when its
 * bounding box is resized. Non-finite factors fall back to 1.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!finiteRect(child) || !finiteRect(from) || !finiteRect(to)) return { ...child };
  const sx = from.width > 0 && Number.isFinite(to.width / from.width) ? to.width / from.width : 1;
  const sy =
    from.height > 0 && Number.isFinite(to.height / from.height) ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
