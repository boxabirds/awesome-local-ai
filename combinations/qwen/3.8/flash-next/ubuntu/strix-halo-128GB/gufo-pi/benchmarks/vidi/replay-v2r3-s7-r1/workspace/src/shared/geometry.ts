/**
 * Pure geometry utilities for selection, marquee, resize and transform (story 7).
 * All coordinates are world units unless stated otherwise.
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

/**
 * Returns true when `inner` lies entirely inside `outer`.
 * Touching edges (inner flush with outer) counts as inside.
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
 * Bounding box of an array of rects. Returns null for an empty array.
 */
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

/**
 * Create a normalised Rect from two screen/world points (positive width/height).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units).
 * When `aspectLocked` is true the width-to-height ratio is preserved.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  // Determine new edges based on handle direction
  let left = x;
  let top = y;
  let right = x + width;
  let bottom = y + height;

  if (handle.includes('w')) left += delta.x;
  if (handle.includes('e')) right += delta.x;
  if (handle.includes('n')) top += delta.y;
  if (handle.includes('s')) bottom += delta.y;

  let newWidth = right - left;
  let newHeight = bottom - top;

  if (aspectLocked) {
    const origRatio = start.width / start.height;
    // Determine which axis changed more and lock the other
    const dw = Math.abs(delta.x);
    const dh = Math.abs(delta.y);

    // Determine the anchor point (opposite corner/edge)
    let anchorX: number;
    let anchorY: number;

    if (handle.includes('w')) {
      anchorX = start.x + start.width; // right edge is anchor
    } else if (handle.includes('e')) {
      anchorX = start.x; // left edge is anchor
    } else {
      anchorX = start.x;
    }

    if (handle.includes('n')) {
      anchorY = start.y + start.height; // bottom edge is anchor
    } else if (handle.includes('s')) {
      anchorY = start.y; // top edge is anchor
    } else {
      anchorY = start.y;
    }

    // For edge handles (n/s or e/w), only one axis moves
    const isHorizontalEdge = handle === 'n' || handle === 's';
    const isVerticalEdge = handle === 'e' || handle === 'w';

    let finalWidth: number;
    let finalHeight: number;

    if (isHorizontalEdge) {
      // Only vertical movement; width follows from height to maintain ratio
      finalHeight = newHeight;
      finalWidth = finalHeight * origRatio;
    } else if (isVerticalEdge) {
      // Only horizontal movement; height follows from width to maintain ratio
      finalWidth = newWidth;
      finalHeight = finalWidth / origRatio;
    } else {
      // Corner handle: use the axis with greater delta to determine size
      if (dw >= dh) {
        finalWidth = newWidth;
        finalHeight = finalWidth / origRatio;
      } else {
        finalHeight = newHeight;
        finalWidth = finalHeight * origRatio;
      }
    }

    // Ensure positive dimensions
    if (finalWidth < 0) finalWidth = 0;
    if (finalHeight < 0) finalHeight = 0;

    // Position from anchor
    let newX: number;
    let newY: number;

    if (handle.includes('w')) {
      newX = anchorX - finalWidth;
    } else if (handle.includes('e')) {
      newX = anchorX;
    } else {
      newX = anchorX;
    }

    if (handle.includes('n')) {
      newY = anchorY - finalHeight;
    } else if (handle.includes('s')) {
      newY = anchorY;
    } else {
      newY = anchorY;
    }

    return { x: newX, y: newY, width: finalWidth, height: finalHeight };
  }

  // No aspect lock
  if (newWidth < 0) {
    // Flip
    const tmp = left;
    left = right;
    right = tmp;
    newWidth = -newWidth;
  }
  if (newHeight < 0) {
    const tmp = top;
    top = bottom;
    bottom = tmp;
    newHeight = -newHeight;
  }

  return { x: left, y: top, width: newWidth, height: newHeight };
}

/**
 * Clamp a proposed scale (sx, sy) so that no rect in `rects`, when scaled,
 * falls below its corresponding minSizes[i] or exceeds maxSize.
 * Returns the clamped scale point.
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

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i];
    if (r.width > 0) {
      const lo = min / r.width;
      const hi = maxSize / r.width;
      if (lo > minSx) minSx = lo;
      if (hi < maxSx) maxSx = hi;
    }
    if (r.height > 0) {
      const lo = min / r.height;
      const hi = maxSize / r.height;
      if (lo > minSy) minSy = lo;
      if (hi < maxSy) maxSy = hi;
    }
  }

  let sx = scale.x;
  let sy = scale.y;

  if (sx < minSx) sx = minSx;
  if (sx > maxSx) sx = maxSx;
  if (sy < minSy) sy = minSy;
  if (sy > maxSy) sy = maxSy;

  return { x: sx, y: sy };
}

/**
 * Map a child rect from the coordinate space of `from` to the coordinate space of `to`.
 * The child's position and size are mapped proportionally.
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
