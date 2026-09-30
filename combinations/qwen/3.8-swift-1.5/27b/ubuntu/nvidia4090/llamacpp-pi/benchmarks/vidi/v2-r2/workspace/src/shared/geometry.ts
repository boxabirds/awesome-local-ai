/**
 * Pure world-unit geometry for selection, marquee and group resize.
 * (Story 7, sel.geometry_ops.)
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

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** True when every edge of `inner` lies inside `outer` (touching from outside is not contained). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    inner.x + inner.width <= outer.x + outer.width &&
    outer.y <= inner.y &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect covering all inputs; null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned rect spanning two points (any quadrant). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function isCorner(handle: Handle): boolean {
  return handle.length === 2;
}

/**
 * New bounding box after dragging `handle` by `delta` (world units).
 * Edge handles change one axis, corner handles both; `aspectLocked` keeps
 * the width/height ratio (anchored at the opposite corner/edge).
 *
 * For corner handles the dominant axis (the larger scale) wins; for edge
 * handles the pointer axis drives both dimensions.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  switch (handle) {
    case 'e':
      width = start.width + delta.x;
      break;
    case 'w':
      width = start.width - delta.x;
      break;
    case 's':
      height = start.height + delta.y;
      break;
    case 'n':
      height = start.height - delta.y;
      break;
    case 'se':
      width = start.width + delta.x;
      height = start.height + delta.y;
      break;
    case 'ne':
      width = start.width + delta.x;
      height = start.height - delta.y;
      break;
    case 'sw':
      width = start.width - delta.x;
      height = start.height + delta.y;
      break;
    case 'nw':
      width = start.width - delta.x;
      height = start.height - delta.y;
      break;
  }

  let newWidth = width;
  let newHeight = height;
  if (aspectLocked && start.width > 0 && start.height > 0) {
    const sx = width / start.width;
    const sy = height / start.height;
    const scale = isCorner(handle) ? Math.max(sx, sy) : handle === 'e' || handle === 'w' ? sx : sy;
    newWidth = start.width * scale;
    newHeight = start.height * scale;
  }

  // The handle's own axis anchors at the opposite edge; the perpendicular
  // axis anchors at top/left (e/w grow downward, n/s grow rightward).
  const x = handle.includes('w') ? start.x + start.width - newWidth : start.x;
  const y = handle.includes('n') ? start.y + start.height - newHeight : start.y;
  return { x, y, width: newWidth, height: newHeight };
}

/**
 * The single uniform scale at which no child rect crosses its `minSize`
 * (per rect) or `maxSize` (global): the input scale clamped so the first
 * object to hit a limit stops the whole selection. Returns a per-axis
 * clamp (both axes are clamped against the same per-axis limits).
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let lowerX = 0;
  let upperX = Infinity;
  let lowerY = 0;
  let upperY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      if (min / r.width > lowerX) lowerX = min / r.width;
      if (maxSize / r.width < upperX) upperX = maxSize / r.width;
    }
    if (r.height > 0) {
      if (min / r.height > lowerY) lowerY = min / r.height;
      if (maxSize / r.height < upperY) upperY = maxSize / r.height;
    }
  }
  return {
    x: Math.min(Math.max(scale.x, lowerX), upperX),
    y: Math.min(Math.max(scale.y, lowerY), upperY),
  };
}

/** Affine image of `child` under the map that takes `from` to `to`. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 0 : to.width / from.width;
  const sy = from.height === 0 ? 0 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}

/**
 * `start` scaled by `scale` and anchored at the corner/edge opposite
 * `handle` (the handle keeps its side of the box under the pointer).
 */
export function scaledRectFromHandle(start: Rect, handle: Handle, scale: Point): Rect {
  const w = start.width * scale.x;
  const h = start.height * scale.y;
  const x = handle.includes('w') ? start.x + start.width - w : start.x;
  const y = handle.includes('n') ? start.y + start.height - h : start.y;
  return { x, y, width: w, height: h };
}
