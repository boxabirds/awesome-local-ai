/**
 * Board geometry: rectangles in board units, and the maths every object type
 * uses for marquee selection, bounding boxes, group moving and resizing
 * (story 7). Pure functions only — nothing here touches a document or the DOM,
 * so the same rules hold on a phone, a desktop page and a future export.
 */

/** A point in board (world) units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in board units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which corner or edge of a bounding box a resize handle sits on. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The eight handles, in the order a ring around the box is drawn. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Screen name of each handle, for accessible labels. */
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

function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

function isRect(rect: Rect): boolean {
  return finite(rect.x, rect.y, rect.width, rect.height);
}

/**
 * True when `inner` lies entirely inside `outer`: all four of its edges are on
 * or within the outer rectangle. Touching an edge from the inside counts as
 * inside; touching one from outside does not, because then some part of the
 * object is outside. Used for the marquee's "fully inside" rule.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isRect(outer) || !isRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest box holding every rectangle, or null when there are none. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    if (!isRect(rect)) continue;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rectangle between two drag corners, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finite(a.x, a.y, b.x, b.y)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Where a box is held while a given handle is dragged: 0 means the minimum edge
 * of that axis stays put, 1 the maximum edge, 0.5 the centre. An edge handle
 * holds the centre of the axis it is not moving, so a width-only resize grows
 * symmetrically when the proportions are locked.
 */
function handleAnchor(handle: Handle): { ax: number; ay: number } {
  const ax = handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5;
  const ay = handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5;
  return { ax, ay };
}

/** Which axis a handle drags: -1 the minimum edge, 1 the maximum, 0 neither. */
function handleAxis(handle: Handle): { hx: number; hy: number } {
  const hx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const hy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  return { hx, hy };
}

/**
 * The box produced by dragging `handle` of `start` by `delta`, held at the
 * opposite corner or edge. With `aspectLocked` the axis that moved furthest
 * drives both, so a sticky note stays square and a Shift-constrained resize
 * keeps the box's proportions. A box is never flipped through zero; non-finite
 * input returns the box unchanged.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isRect(start) || !finite(delta.x, delta.y)) return { ...start };
  if (start.width <= 0 || start.height <= 0) return { ...start };
  const { hx, hy } = handleAxis(handle);
  let sx = hx === 0 ? 1 : Math.max(0, (start.width + hx * delta.x) / start.width);
  let sy = hy === 0 ? 1 : Math.max(0, (start.height + hy * delta.y) / start.height);
  if (aspectLocked) {
    // The axis the pointer moved most along wins, so pushing a corner out by
    // (100, 40) grows a square note by 50% rather than 20%.
    const driven = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    sx = driven;
    sy = driven;
  }
  return scaleRectAbout(start, handle, { x: sx, y: sy });
}

/**
 * `start` scaled by `scale`, held where `handle` says: the opposite corner or
 * edge stays put, and an axis the handle does not drag keeps its place unless it
 * is being scaled by a locked ratio, in which case it grows around the centre.
 */
export function scaleRectAbout(start: Rect, handle: Handle, scale: Point): Rect {
  if (!isRect(start) || !finite(scale.x, scale.y)) return { ...start };
  const { ax, ay } = handleAnchor(handle);
  const width = Math.max(0, start.width * scale.x);
  const height = Math.max(0, start.height * scale.y);
  return {
    x: ax === 0 ? start.x : ax === 1 ? start.x + start.width - width : start.x + (start.width - width) / 2,
    y: ay === 0 ? start.y : ay === 1 ? start.y + start.height - height : start.y + (start.height - height) / 2,
    width,
    height,
  };
}

/**
 * The largest (or, when shrinking, smallest) scale at which no object in
 * `rects` crosses its own `minSizes[i]` or the shared `maxSize`.
 *
 * One scale for the whole selection: objects would otherwise stop at different
 * times and the layout would distort (design key decision 2). A request whose
 * two axes are equal is answered with equal axes — the selection stops as soon
 * as the first object reaches either limit. Non-finite requests mean "no
 * resize".
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (!finite(scale.x, scale.y)) return { x: 1, y: 1 };
  let loX = 0;
  let loY = 0;
  let hiX = Infinity;
  let hiY = Infinity;
  rects.forEach((rect, index) => {
    if (!isRect(rect) || rect.width <= 0 || rect.height <= 0) return;
    const min = finite(minSizes[index] ?? 0) ? Math.max(0, minSizes[index]!) : 0;
    loX = Math.max(loX, min / rect.width);
    loY = Math.max(loY, min / rect.height);
    if (finite(maxSize) && maxSize > 0) {
      hiX = Math.min(hiX, maxSize / rect.width);
      hiY = Math.min(hiY, maxSize / rect.height);
    }
  });
  const clamp = (value: number, lo: number, hi: number): number =>
    Math.min(Math.max(value, lo), hi);
  let sx = clamp(scale.x, loX, hiX);
  let sy = clamp(scale.y, loY, hiY);
  if (scale.x === scale.y) {
    // A uniform request stays uniform: whichever axis hit its limit first
    // decides, and the other follows it.
    const uniform = scale.x >= 1 ? Math.min(sx, sy) : Math.max(sx, sy);
    sx = uniform;
    sy = uniform;
  }
  return { x: sx, y: sy };
}

/**
 * `child` moved from the box `from` into the box `to`, the way a picture moves
 * inside a resized frame: every position and size is scaled by the box's own
 * factor, so gaps between objects scale with them. A degenerate `from` returns
 * the child unchanged rather than dividing by zero.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isRect(child) || !isRect(from) || !isRect(to)) return { ...child };
  if (from.width <= 0 || from.height <= 0) return { ...child };
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
