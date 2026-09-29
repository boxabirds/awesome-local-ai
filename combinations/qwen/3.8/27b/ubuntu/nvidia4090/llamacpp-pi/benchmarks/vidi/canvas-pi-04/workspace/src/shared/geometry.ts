// Story 7: pure selection geometry (anchor: sel.geometry_ops).
//
// World-unit rectangles and the bounding-box resize math. Framework-free (no
// React, no DOM): the transform gesture, the selection overlay and the
// board-model all share these primitives. All functions are pure and return
// new values.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in world units (top-left corner + size). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles around a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const HANDLES: readonly string[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Whether `value` is one of the eight handle names. */
export function isHandle(value: string): value is Handle {
  return HANDLES.includes(value);
}

/**
 * Whether `inner` lies entirely within `outer`. Edges that merely coincide
 * count as inside (a box drawn exactly around an object encloses it).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The bounding box of all rects, or null when `rects` is empty. */
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

/**
 * The axis-aligned rect spanning the two points: top-left is the minimum
 * corner, the size is the absolute span. A zero-area rect when the points
 * coincide.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Place a box of the given size with the anchor for `handle` held at `start`
 * (the opposite corner/edge stays fixed). Shared by `resizeRect` and the
 * transform gesture, which builds the clamped target box the same way.
 */
export function placeBox(start: Rect, handle: Handle, width: number, height: number): Rect {
  let x = start.x;
  let y = start.y;
  if (handle.includes('w')) x = start.x + start.width - width;
  if (handle.includes('n')) y = start.y + start.height - height;
  return { x, y, width, height };
}

/**
 * Resize a rect by dragging `handle` by `delta` (world units). The opposite
 * corner/edge is the fixed anchor. When `aspectLocked` the start
 * width-to-height ratio is preserved: for any handle that moves the width
 * (corners and e/w edges) the width is primary and the height follows the
 * ratio, and for n/s edges the height is primary.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  const hasH = handle.includes('e') || handle.includes('w');

  // Free (unlocked) new size from the delta.
  let freeW = start.width;
  let freeH = start.height;
  if (handle.includes('e')) freeW = start.width + delta.x;
  if (handle.includes('w')) freeW = start.width - delta.x;
  if (handle.includes('s')) freeH = start.height + delta.y;
  if (handle.includes('n')) freeH = start.height - delta.y;

  let nw = freeW;
  let nh = freeH;
  if (aspectLocked && start.width !== 0) {
    const ratio = start.height / start.width; // H / W
    if (hasH) {
      // Width is primary (corners and e/w edges): height follows the ratio.
      nw = freeW;
      nh = freeW * ratio;
    } else {
      // n/s edge only: height is primary, width follows the ratio.
      nh = freeH;
      nw = freeH / ratio;
    }
  }

  return placeBox(start, handle, nw, nh);
}

/**
 * Clamp a bounding-box scale so that NO object crosses its minimum size or
 * the shared maximum, then return the single clamped scale (one Point applied
 * to every object). Each axis is clamped independently; the object that first
 * reaches a limit bounds that axis, so the whole selection stops together.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  let minScaleX = 0;
  let maxScaleX = Infinity;
  let minScaleY = 0;
  let maxScaleY = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    const min = minSizes[i];
    if (r.width > 0) {
      minScaleX = Math.max(minScaleX, min / r.width);
      maxScaleX = Math.min(maxScaleX, maxSize / r.width);
    }
    if (r.height > 0) {
      minScaleY = Math.max(minScaleY, min / r.height);
      maxScaleY = Math.min(maxScaleY, maxSize / r.height);
    }
  }
  return {
    x: clamp(scale.x, minScaleX, maxScaleX),
    y: clamp(scale.y, minScaleY, maxScaleY),
  };
}

/**
 * The rect where `child` lands when the region `from` is affine-transformed
 * to `to` (per-axis scale + translation). Used to reposition and resize each
 * selected object relative to its selection's bounding box.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width !== 0 ? to.width / from.width : 0;
  const sy = from.height !== 0 ? to.height / from.height : 0;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return value < 0 ? lo : hi;
  return Math.min(hi, Math.max(lo, value));
}
