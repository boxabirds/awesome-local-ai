import type { Point } from '../client/canvas/camera';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * Returns true when `inner` lies entirely inside `outer`.
 * Touching edges from outside is NOT containment.
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
 * Returns the smallest rect enclosing all given rects, or null for empty input.
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Given two screen/world points, return a normalized Rect (positive width/height).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resize a rect by dragging a handle. `delta` is the pointer movement in world units.
 * When `aspectLocked` is true the bounding box keeps its width-to-height ratio.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  // Determine new edges after the drag
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

  // Prevent flipping
  if (newWidth <= 0) newWidth = 1;
  if (newHeight <= 0) newHeight = 1;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const startRatio = start.width / start.height;
    // Determine which axis to prioritize based on the handle
    const isCorner = handle.length === 2;
    const isHorizontal = handle === 'e' || handle === 'w';
    const isVertical = handle === 'n' || handle === 's';

    if (isHorizontal) {
      newHeight = newWidth / startRatio;
    } else if (isVertical) {
      newWidth = newHeight * startRatio;
    } else if (isCorner) {
      // Use the dominant axis for the corner
      const dx = Math.abs(newWidth - start.width);
      const dy = Math.abs(newHeight - start.height);
      if (dx >= dy) {
        newHeight = newWidth / startRatio;
      } else {
        newWidth = newHeight * startRatio;
      }
    }

    // Recalculate edges maintaining the anchor (opposite corner/edge)
    if (handle.includes('w')) {
      left = right - newWidth;
    } else {
      right = left + newWidth;
    }
    if (handle.includes('n')) {
      top = bottom - newHeight;
    } else {
      bottom = top + newHeight;
    }
  }

  return { x: left, y: top, width: newWidth, height: newHeight };
}

/**
 * Clamp a scale factor so that no object in `rects` would go below its `minSizes[i]`
 * or above `maxSize` after scaling. Returns the clamped scale point.
 *
 * The scale is computed from the bounding box. `rects` are the individual object rects.
 * `minSizes` is per-object minimum size. The result is a single uniform scale clamped
 * so the whole selection stops at the first object reaching its limit.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let clampedX = scale.x;
  let clampedY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;

    // Check minimum: newWidth = r.width * clampedX >= min → clampedX >= min/r.width
    if (r.width > 0) {
      const minScaleX = min / r.width;
      if (clampedX < minScaleX) clampedX = minScaleX;
    }
    if (r.height > 0) {
      const minScaleY = min / r.height;
      if (clampedY < minScaleY) clampedY = minScaleY;
    }

    // Check maximum: newWidth = r.width * clampedX <= maxSize → clampedX <= maxSize/r.width
    if (r.width > 0) {
      const maxScaleX = maxSize / r.width;
      if (clampedX > maxScaleX) clampedX = maxScaleX;
    }
    if (r.height > 0) {
      const maxScaleY = maxSize / r.height;
      if (clampedY > maxScaleY) clampedY = maxScaleY;
    }
  }

  // Ensure scale doesn't go negative
  if (clampedX <= 0) clampedX = 0.001;
  if (clampedY <= 0) clampedY = 0.001;

  return { x: clampedX, y: clampedY };
}

/**
 * Map a child rect from within a `from` bounding box to the corresponding position
 * within a `to` bounding box (proportional scaling and translation).
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return { ...child };
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
