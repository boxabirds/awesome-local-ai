/**
 * Pure rectangle/point geometry for multi-selection and group transforms
 * (story 7). No DOM, no Yjs — used by the board-model group operations and
 * the client transform gesture.
 *
 * All values are world (board) units. A `Rect` is a top-left origin box:
 * `{ x, y, width, height }` with the bottom-right at `(x+width, y+height)`.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The eight bounding-box resize handles. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when every edge of `inner` lies inside (or on) `outer`.
 * An object that is only partly inside, or merely touches an edge from
 * outside, is NOT contained (sel.marquee containment rule).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rect containing every rect. Non-finite rects are ignored.
 * Returns null for an empty (or all-invalid) list.
 */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      continue;
    }
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rect spanned by two points (normalised so width/height are >= 0). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resize `start` by dragging its `handle` by `delta` (world units), anchored
 * on the opposite corner/edge:
 *
 * - edge handles change one axis; corner handles change both;
 * - `aspectLocked` keeps the start rect's width:height ratio, anchored on the
 *   opposite corner/edge. The scale is the dominant axis ratio for corners
 *   and the single controlled-axis ratio for edge handles.
 *
 * The result may have zero/negative width/height when the drag crosses the
 * opposite edge; callers must clamp via `clampScale` before applying.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!aspectLocked) {
    const width = start.width + (handle.includes('e') ? delta.x : handle.includes('w') ? -delta.x : 0);
    const height = start.height + (handle.includes('s') ? delta.y : handle.includes('n') ? -delta.y : 0);
    return {
      x: handle.includes('w') ? start.x + delta.x : start.x,
      y: handle.includes('n') ? start.y + delta.y : start.y,
      width,
      height,
    };
  }

  const scaleX = start.width > 0 ? (start.width + (handle.includes('e') ? delta.x : handle.includes('w') ? -delta.x : 0)) / start.width : 1;
  const scaleY = start.height > 0 ? (start.height + (handle.includes('s') ? delta.y : handle.includes('n') ? -delta.y : 0)) / start.height : 1;
  const scale = Math.max(handle.length === 1 ? (handle === 'e' || handle === 'w' ? scaleX : scaleY) : Math.max(scaleX, scaleY), 0.01);

  const width = start.width * scale;
  const height = start.height * scale;
  return {
    x: handle.includes('w') ? start.x + start.width - width : start.x,
    y: handle.includes('n') ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

/**
 * Clamp a proposed scale so no object crosses its per-object minimum size or
 * the global `maxSize`, on each axis independently. Returns the largest (or
 * smallest) scale at which every object stays within its limits — the single
 * scale the whole selection stops at (sel.size_limits, design decision 2).
 *
 * Non-finite or non-positive input scales return `{ x: 1, y: 1 }` (no change).
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let sx = scale.x;
  let sy = scale.y;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
    return { x: 1, y: 1 };
  }

  let upperX = Infinity;
  let lowerX = 0;
  let upperY = Infinity;
  let lowerY = 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = i < minSizes.length ? minSizes[i] : 0;
    if (Number.isFinite(r.width) && r.width > 0) {
      upperX = Math.min(upperX, maxSize / r.width);
      if (min > 0) lowerX = Math.max(lowerX, min / r.width);
    }
    if (Number.isFinite(r.height) && r.height > 0) {
      upperY = Math.min(upperY, maxSize / r.height);
      if (min > 0) lowerY = Math.max(lowerY, min / r.height);
    }
  }
  if (lowerX > upperX) lowerX = upperX;
  if (lowerY > upperY) lowerY = upperY;
  return {
    x: Math.min(Math.max(sx, lowerX), upperX),
    y: Math.min(Math.max(sy, lowerY), upperY),
  };
}

/**
 * The box `start` becomes when scaled by `scale`, anchored on the opposite
 * corner/edge implied by `handle` (west/north handles grow from the right/
 * bottom). Used by the resize gesture after `clampScale`.
 */
export function anchoredBox(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  return {
    x: handle.includes('w') ? start.x + start.width - width : start.x,
    y: handle.includes('n') ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

/**
 * Position and scale `child` inside `to` using `from` as the reference frame:
 * the child keeps its relative offset (from the frame origin) and its
 * relative size (against the frame), so a group resized by scaling its
 * bounding box keeps its internal layout (sel.resize).
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width !== 0 ? to.width / from.width : 1;
  const sy = from.height !== 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
