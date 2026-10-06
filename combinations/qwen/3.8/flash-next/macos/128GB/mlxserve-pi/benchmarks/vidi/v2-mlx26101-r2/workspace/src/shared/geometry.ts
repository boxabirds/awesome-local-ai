/**
 * Pure rectangle maths for selection and transform (story 7).
 *
 * Everything here is in *world* units and free of Yjs, React and the DOM: the
 * transform gesture, the marquee and the board-model group operations all share
 * these functions, so a rectangle means the same thing wherever it is computed.
 *
 * A `Rect` is a top-left corner plus a width and height. `normalizeRect` builds
 * one out of two opposite corners in any order, which is what a drag from an
 * arbitrary start point to an arbitrary end point produces.
 *
 * The single biggest rule in this file: a resize is *anchored at the opposite
 * corner or edge*. The corner the pointer is not holding stays exactly where it
 * was, so a box grows away from the point you are holding it by - which is the
 * one behaviour that makes grabbing the top-left handle feel right.
 */

/** An axis-aligned rectangle in world units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in world units (or screen pixels, at the call site's discretion). */
export interface Point {
  x: number;
  y: number;
}

/** The eight resize handles, named for the compass point they sit on. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order the overlay draws them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** A rectangle that never contains anything (also the union of no rectangles). */
const isFiniteRect = (r: Rect): boolean =>
  Number.isFinite(r.x) &&
  Number.isFinite(r.y) &&
  Number.isFinite(r.width) &&
  Number.isFinite(r.height);

/**
 * True when `inner` lies entirely inside `outer`. The edges are inclusive, so a
 * rectangle that exactly touches `outer`'s border counts as inside; anything
 * that pokes past one edge does not. This is the marquee's containment rule
 * (`sel.marquee`): an object is selected only when *all four* of its edges lie
 * inside the marquee rectangle.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rectangle that contains all of `rects`, or `null` when there is
 * nothing to enclose. This is the bounding box the selection bar and the resize
 * handles are drawn around (`sel.resize`).
 */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!isFiniteRect(r)) continue;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A rectangle with positive width and height from any two opposite corners. A
 * marquee can be dragged in any direction; this turns "where the pointer started"
 * and "where it is now" into a rectangle regardless of which corner they are.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Which edges a handle moves. */
const movesLeft = (h: Handle): boolean => h === 'w' || h === 'nw' || h === 'sw';
const movesRight = (h: Handle): boolean => h === 'e' || h === 'ne' || h === 'se';
const movesTop = (h: Handle): boolean => h === 'n' || h === 'nw' || h === 'ne';
const movesBottom = (h: Handle): boolean => h === 's' || h === 'sw' || h === 'se';

/**
 * Rebuild a rectangle from the *opposite* anchor with a per-axis scale: the edge
 * the handle is not on stays put, so the box grows away from the anchor. `scale`
 * is (width factor, height factor); the two differ on a non-aspect edge drag.
 */
export function scaleRectFrom(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  // When the handle is on the left/top edge, that edge moves and the right/bottom
  // edge is the anchor; otherwise the opposite way round.
  const x = movesLeft(handle) ? start.x + start.width - width : start.x;
  const y = movesTop(handle) ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

/**
 * Resize `start` by dragging `handle` through `delta` (world units), optionally
 * keeping the original proportions (`aspectLocked`).
 *
 * An edge handle moves one edge, so only one axis changes: `e` changes width and
 * leaves height alone. A corner handle moves both. When `aspectLocked` the whole
 * box keeps the ratio it started with, measured from the opposite anchor: the
 * larger of the two requested factors wins, so the pointer always feels like it
 * is holding the corner it grabbed (TC-01: 200×200 + (100,40) on `se` → 300×300).
 *
 * This returns the *unclamped* target; the caller passes the implied scale to
 * {@link clampScale} to respect each type's minimum and the global maximum.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!isFiniteRect(start) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return start;
  }
  const horizontal = movesLeft(handle) || movesRight(handle);
  const vertical = movesTop(handle) || movesBottom(handle);
  // The scale the raw drag implies on each axis, measured so a positive delta on
  // a right/bottom handle grows and on a left/top handle shrinks.
  let sx = 1;
  let sy = 1;
  if (movesRight(handle)) sx = (start.width + delta.x) / start.width;
  else if (movesLeft(handle)) sx = (start.width - delta.x) / start.width;
  if (movesBottom(handle)) sy = (start.height + delta.y) / start.height;
  else if (movesTop(handle)) sy = (start.height - delta.y) / start.height;

  if (aspectLocked) {
    // One factor for both axes. A corner uses whichever axis the pointer pushed
    // further; a single-edge handle uses the axis it actually moves.
    let s: number;
    if (horizontal && vertical) s = Math.max(sx, sy);
    else if (horizontal) s = sx;
    else if (vertical) s = sy;
    else s = 1;
    if (!Number.isFinite(s) || s <= 0) s = 0;
    sx = s;
    sy = s;
  }

  return scaleRectFrom(start, handle, { x: sx, y: sy });
}

/**
 * Clamp a requested per-axis resize `scale` so that no rectangle in `rects`
 * crosses its own minimum (`minSizes[i]`) or the shared `maxSize`.
 *
 * The clamp is per axis (the returned `Point` is (width factor, height factor))
 * and, within each axis, it is the *tightest* bound over every object: the whole
 * selection stops the instant the first object reaches a limit, so a group never
 * distorts (Key decision 2). `minSizes[i]` may be 0 (no minimum); a rectangle
 * with a non-positive side contributes no bound on that axis.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let minSx = 0;
  let minSy = 0;
  let maxSx = Infinity;
  let maxSy = Infinity;
  rects.forEach((r, i) => {
    if (!isFiniteRect(r)) return;
    const min = Number.isFinite(minSizes[i]) && minSizes[i] > 0 ? minSizes[i] : 0;
    if (r.width > 0) {
      if (min / r.width > minSx) minSx = min / r.width;
      if (maxSize / r.width < maxSx) maxSx = maxSize / r.width;
    }
    if (r.height > 0) {
      if (min / r.height > minSy) minSy = min / r.height;
      if (maxSize / r.height < maxSy) maxSy = maxSize / r.height;
    }
  });
  const clampAxis = (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return min;
    // max >= min by construction (min <= maxSize/side <= max whenever min <= maxSize);
    // if a type's minSize exceeded maxSize, min would win, which is the safe choice.
    if (value < min) return min;
    if (value > max) return max;
    return value;
  };
  return { x: clampAxis(scale.x, minSx, maxSx), y: clampAxis(scale.y, minSy, maxSy) };
}

/**
 * Place `child` (a rectangle expressed inside `from`) inside `to`, scaling its
 * position and size by the box's own change. This is how a group resize lays out
 * each member object: every object's rect is `child`, `from` is the selection's
 * starting bounding box and `to` is the box it has been resized to.
 *
 * Gaps scale with the objects, so the layout is preserved in relative terms
 * (TC-04: two 200-unit notes 100 apart, box doubled in width → 400-wide notes with
 * a 200-unit gap). A zero-width/height `from` contributes no scale on that axis.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
