/**
 * Pure geometry helpers for selection, marquee, move and resize operations.
 *
 * All coordinates are in world units unless explicitly stated otherwise.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resize handle positions (compass-style). */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when `outer` fully contains `inner` (all four edges of inner are inside outer).
 * Touching the edge from outside counts as NOT contained.
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
 * Returns the smallest axis-aligned rectangle containing all given rects,
 * or null when the array is empty.
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
 * Normalizes two screen/world points into a Rect with positive width and height.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resizes `start` by dragging the given `handle` by `delta` (in world units).
 *
 * - Edge handles resize one axis; corner handles resize both.
 * - When `aspectLocked` is true, the width-to-height ratio is preserved.
 * - The anchor is the opposite corner/edge.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine new dimensions based on handle direction
  const moveLeft = handle.includes('w');
  const moveRight = handle.includes('e');
  const moveTop = handle.includes('n');
  const moveBottom = handle.includes('s');

  let newWidth = width;
  let newHeight = height;
  let newX = x;
  let newY = y;

  if (moveRight) newWidth = width + delta.x;
  if (moveLeft) {
    newWidth = width - delta.x;
    newX = x + delta.x;
  }
  if (moveBottom) newHeight = height + delta.y;
  if (moveTop) {
    newHeight = height - delta.y;
    newY = y + delta.y;
  }

  // For edge-only handles (no horizontal component), width stays
  if (!moveLeft && !moveRight) {
    newWidth = width;
    newX = x;
  }
  // For edge-only handles (no vertical component), height stays
  if (!moveTop && !moveBottom) {
    newHeight = height;
    newY = y;
  }

  if (aspectLocked) {
    // Preserve the original ratio
    const ratio = width > 0 ? width / height : 1;
    const isCorner = (moveLeft || moveRight) && (moveTop || moveBottom);
    if (isCorner) {
      // Use the larger relative change to determine the final size
      const scaleW = height > 0 ? newWidth / width : 1;
      const scaleH = width > 0 ? newHeight / height : 1;
      // Use the dimension that changed more
      const scale = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
      newWidth = width * scale;
      newHeight = newWidth / ratio;
    } else if (moveLeft || moveRight) {
      newHeight = newWidth / ratio;
    } else {
      // moveTop or moveBottom
      newWidth = newHeight * ratio;
    }
    // Adjust anchor position
    if (moveLeft) newX = x + width - newWidth;
    else newX = x;
    if (moveTop) newY = y + height - newHeight;
    else newY = y;
  }

  // Clamp to non-negative (the downstream clampScale will enforce the actual minimum)
  if (newWidth < 0) {
    newX = newX + newWidth;
    newWidth = 0;
  }
  if (newHeight < 0) {
    newY = newY + newHeight;
    newHeight = 0;
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Clamps a proposed (scaleX, scaleY) so that no object in `rects` would become
 * smaller than its corresponding `minSizes[i]` or larger than `maxSize`.
 *
 * Returns a single uniform scale factor as a Point (same value for x and y when aspect is
 * locked, potentially different when not).
 *
 * The scale is relative to a bounding box; each object's new size is its old size * scale.
 * We find the most restrictive scale that keeps every object within its limits.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return scale;

  let clampedX = scale.x;
  let clampedY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const minSize = minSizes[i] ?? 0;

    // Constrain X scale (treat non-positive scale as 0)
    if (clampedX <= 0 && r.width > 0) {
      clampedX = r.width > 0 && minSize > 0 ? minSize / r.width : 0;
    } else if (r.width > 0) {
      const newWidth = r.width * clampedX;
      if (newWidth < minSize) clampedX = minSize / r.width;
      if (newWidth > maxSize) clampedX = maxSize / r.width;
    }
    // Constrain Y scale (treat non-positive scale as 0)
    if (clampedY <= 0 && r.height > 0) {
      clampedY = r.height > 0 && minSize > 0 ? minSize / r.height : 0;
    } else if (r.height > 0) {
      const newHeight = r.height * clampedY;
      if (newHeight < minSize) clampedY = minSize / r.height;
      if (newHeight > maxSize) clampedY = maxSize / r.height;
    }
  }

  // If aspect locked (scale.x === scale.y), use the more restrictive
  if (scale.x === scale.y) {
    const uniform = Math.min(clampedX, clampedY);
    return { x: uniform, y: uniform };
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Maps a child rect from being inside `from` to being inside `to` (proportional scaling).
 *
 * Each object's position and size are scaled proportionally within the bounding box.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;

  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
