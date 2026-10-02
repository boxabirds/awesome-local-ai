/**
 * Pure geometry for selection, marquee and group transforms (story 7).
 *
 * All values are in world units. No Yjs, no DOM: the board-model group
 * operations and the transform gesture compose these functions.
 */
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

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

function finiteRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

/** True when every edge of `inner` lies on or inside `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finiteRect(outer) || !finiteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Bounding box of `rects`, or null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const r of rects) {
    if (!finiteRect(r)) continue;
    found = true;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** Axis-aligned rectangle between two opposite corners (positive size). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

const MOVES_LEFT = (h: Handle) => h.includes('w');
const MOVES_RIGHT = (h: Handle) => h.includes('e');
const MOVES_TOP = (h: Handle) => h.includes('n');
const MOVES_BOTTOM = (h: Handle) => h.includes('s');

/**
 * Grow or shrink `start` by dragging `handle` by `delta` (world units). Edge
 * handles move one axis, corners two; the opposite corner/edge stays fixed.
 * When `aspectLocked`, the width-to-height ratio of `start` is preserved: for a
 * corner the more-deviant axis drives the scale, for an edge that axis does and
 * the free axis grows symmetrically about its centre.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!finiteRect(start) || start.width <= 0 || start.height <= 0) return { ...start };

  const left = MOVES_LEFT(handle);
  const right = MOVES_RIGHT(handle);
  const top = MOVES_TOP(handle);
  const bottom = MOVES_BOTTOM(handle);
  const horizontal = left || right;
  const vertical = top || bottom;

  let newWidth = start.width + (right ? delta.x : 0) - (left ? delta.x : 0);
  let newHeight = start.height + (bottom ? delta.y : 0) - (top ? delta.y : 0);

  if (aspectLocked) {
    const scaleX = horizontal ? newWidth / start.width : 1;
    const scaleY = vertical ? newHeight / start.height : 1;
    let scale: number;
    if (horizontal && vertical) {
      // Corner: the axis the pointer moved most (relatively) wins.
      scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    } else if (horizontal) {
      scale = scaleX;
    } else {
      scale = scaleY;
    }
    newWidth = start.width * scale;
    newHeight = start.height * scale;
  }

  let x: number;
  let y: number;
  if (horizontal && vertical) {
    // Corner: anchor is the opposite corner.
    x = left ? start.x + start.width - newWidth : start.x;
    y = top ? start.y + start.height - newHeight : start.y;
  } else if (horizontal) {
    // Left/right edge: keep the opposite edge; grow vertically about centre.
    x = left ? start.x + start.width - newWidth : start.x;
    y = start.y + (start.height - newHeight) / 2;
  } else if (vertical) {
    // Top/bottom edge: keep the opposite edge; grow horizontally about centre.
    x = start.x + (start.width - newWidth) / 2;
    y = top ? start.y + start.height - newHeight : start.y;
  } else {
    x = start.x;
    y = start.y;
  }

  return { x, y, width: newWidth, height: newHeight };
}

/**
 * Clamp a proposed bounding-box scale so that no object crosses its minimum or
 * the shared maximum once applied via `scaleWithin`. Returns the single largest
 * (or smallest) scale at which every object stays within limits — the whole
 * selection stops at the first object to reach a limit, preserving the layout.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let sx = Number.isFinite(scale.x) ? scale.x : 1;
  let sy = Number.isFinite(scale.y) ? scale.y : 1;

  let loX = 0;
  let loY = 0;
  let hiX = Infinity;
  let hiY = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (!finiteRect(r) || r.width <= 0 || r.height <= 0) continue;
    const min = minSizes[i] ?? 0;
    loX = Math.max(loX, min / r.width);
    loY = Math.max(loY, min / r.height);
    hiX = Math.min(hiX, maxSize / r.width);
    hiY = Math.min(hiY, maxSize / r.height);
  }

  sx = Math.min(Math.max(sx, loX), hiX);
  sy = Math.min(Math.max(sy, loY), hiY);
  return { x: sx, y: sy };
}

/**
 * Map `child` (a rect within bounding box `from`) to the same relative place in
 * bounding box `to`: position and size scale proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!finiteRect(child) || !finiteRect(from) || !finiteRect(to)) return { ...child };
  if (from.width === 0 || from.height === 0) return { ...child };
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
