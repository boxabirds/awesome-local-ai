// Pure geometry utilities for selection, resize, and marquee (story 7).

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
 * Returns true if `outer` fully contains `inner` (all four edges of inner are inside outer).
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
 * Returns the union (bounding box) of all rects, or null if the array is empty.
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
 * Normalizes two screen/world points into a Rect with positive width/height.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resize a rect by dragging a handle. The delta is in world units.
 * The anchor is the opposite corner/edge of the handle.
 * If aspectLocked, the width-to-height ratio of the start rect is preserved.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine new dimensions based on handle direction
  const affectsLeft = handle === 'w' || handle === 'nw' || handle === 'sw';
  const affectsRight = handle === 'e' || handle === 'ne' || handle === 'se';
  const affectsTop = handle === 'n' || handle === 'nw' || handle === 'ne';
  const affectsBottom = handle === 's' || handle === 'sw' || handle === 'se';

  let newWidth = width;
  let newHeight = height;
  let newX = x;
  let newY = y;

  if (affectsRight) newWidth = width + delta.x;
  if (affectsLeft) {
    newWidth = width - delta.x;
    newX = x + delta.x;
  }
  if (affectsBottom) newHeight = height + delta.y;
  if (affectsTop) {
    newHeight = height - delta.y;
    newY = y + delta.y;
  }

  // Prevent negative dimensions
  if (newWidth < 0) {
    newWidth = 0;
    newX = x + width;
  }
  if (newHeight < 0) {
    newHeight = 0;
    newY = y + height;
  }

  if (aspectLocked) {
    const aspectRatio = width / height;
    const isCorner = handle === 'ne' || handle === 'nw' || handle === 'se' || handle === 'sw';
    const isHorizontal = handle === 'e' || handle === 'w';
    const isVertical = handle === 'n' || handle === 's';

    if (isCorner) {
      // Use the larger relative change to determine the size
      const scaleX = width > 0 ? newWidth / width : 1;
      const scaleY = height > 0 ? newHeight / height : 1;
      const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
      newWidth = width * scale;
      newHeight = height * scale;
    } else if (isHorizontal) {
      newHeight = newWidth / aspectRatio;
    } else if (isVertical) {
      newWidth = newHeight * aspectRatio;
    }

    // Adjust position for left/top handles to keep the anchor fixed
    if (affectsLeft) {
      newX = x + width - newWidth;
    }
    if (affectsTop) {
      newY = y + height - newHeight;
    }
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Clamp a scale factor so that no object in rects would violate its minSize or maxSize.
 * scale is the proposed { x: scaleX, y: scaleY } applied to the bounding box.
 * Returns the clamped scale that keeps all objects within their limits.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return scale;

  // The bounding box of all rects
  const bounding = unionRects(rects);
  if (!bounding) return scale;

  let clampedX = scale.x;
  let clampedY = scale.y;

  // For uniform scaling, we use the average scale factor
  // Actually for resize, the scale is applied to the bounding box, so each object's
  // new size = object.size * scale (where scale is derived from bounding box change)
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;

    // Check min size constraint: scale must not go below minSize/size
    const newW = r.width * Math.abs(clampedX);
    const newH = r.height * Math.abs(clampedY);
    if (newW < minSize && r.width > 0) {
      const minScale = minSize / r.width;
      if (Math.abs(clampedX) < minScale) {
        clampedX = Math.sign(clampedX || 1) * minScale;
      }
    }
    if (newH < minSize && r.height > 0) {
      const minScale = minSize / r.height;
      if (Math.abs(clampedY) < minScale) {
        clampedY = Math.sign(clampedY || 1) * minScale;
      }
    }

    // Check max size constraint
    const newWMax = r.width * Math.abs(clampedX);
    const newHMax = r.height * Math.abs(clampedY);
    if (newWMax > maxSize && r.width > 0) {
      const limitScale = maxSize / r.width;
      if (Math.abs(clampedX) > limitScale) {
        clampedX = Math.sign(clampedX) * limitScale;
      }
    }
    if (newHMax > maxSize && r.height > 0) {
      const limitScale = maxSize / r.height;
      if (Math.abs(clampedY) > limitScale) {
        clampedY = Math.sign(clampedY) * limitScale;
      }
    }
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Scale a child rect from one bounding rect to another (proportional positioning).
 * The child is repositioned and resized proportionally within the new bounds.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) {
    return { ...child };
  }
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
