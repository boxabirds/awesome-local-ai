// Pure geometry utilities for selection, marquee, resize and group transforms.

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
 * Returns true if `inner` is entirely within `outer`.
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
 * Returns the bounding rectangle of a list of rects, or null for an empty list.
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
 * Normalize two points into a Rect with positive width/height.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return { x, y, width, height };
}

/**
 * Resize a rect by dragging a handle by `delta` (in world units).
 * When `aspectLocked` is true, the width:height ratio is preserved.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine which edges are being moved
  const moveLeft = handle === 'w' || handle === 'nw' || handle === 'sw';
  const moveRight = handle === 'e' || handle === 'ne' || handle === 'se';
  const moveTop = handle === 'n' || handle === 'nw' || handle === 'ne';
  const moveBottom = handle === 's' || handle === 'sw' || handle === 'se';

  let newX = x, newY = y, newW = width, newH = height;

  if (moveLeft) {
    newW = width - delta.x;
    newX = x + delta.x;
  } else if (moveRight) {
    newW = width + delta.x;
  }

  if (moveTop) {
    newH = height - delta.y;
    newY = y + delta.y;
  } else if (moveBottom) {
    newH = height + delta.y;
  }

  if (aspectLocked) {
    // Determine the scale factor from whichever axis changed
    const isCorner = (moveLeft || moveRight) && (moveTop || moveBottom);
    const isHorizontalOnly = (moveLeft || moveRight) && !moveTop && !moveBottom;
    const isVerticalOnly = (moveTop || moveBottom) && !moveLeft && !moveRight;

    if (isCorner) {
      // Use the axis with larger scale change
      const sx = width > 0 ? newW / width : 1;
      const sy = height > 0 ? newH / height : 1;
      const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      newW = width * s;
      newH = height * s;
      // Adjust position for corners that move left/top
      if (moveLeft) newX = x + width - newW;
      if (moveTop) newY = y + height - newH;
    } else if (isHorizontalOnly) {
      const s = width > 0 ? newW / width : 1;
      newH = height * s;
      if (moveTop) newY = y + height - newH;
      // center vertically
      if (!moveTop) {
        const anchorY = y + height / 2;
        newY = anchorY - newH / 2;
      }
    } else if (isVerticalOnly) {
      const s = height > 0 ? newH / height : 1;
      newW = width * s;
      if (moveLeft) newX = x + width - newW;
      // center horizontally
      if (!moveLeft) {
        const anchorX = x + width / 2;
        newX = anchorX - newW / 2;
      }
    }
  }

  // Ensure positive dimensions
  if (newW < 0) {
    newX = newX + newW;
    newW = -newW;
  }
  if (newH < 0) {
    newY = newY + newH;
    newH = -newH;
  }

  return { x: newX, y: newY, width: newW, height: newH };
}

/**
 * Clamp the scale factor so that no object in `rects` would go below its
 * corresponding `minSizes[i]` or above `maxSize` after scaling.
 * Returns a uniform scale {x, y} (same for both axes when aspectLocked).
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
    const minSize = i < minSizes.length ? minSizes[i] : 1;
    const max = maxSize;

    // Check x scale
    if (r.width > 0) {
      const newW = r.width * clampedX;
      if (newW < minSize) clampedX = minSize / r.width;
      if (newW > max) clampedX = Math.min(clampedX, max / r.width);
    }
    // Check y scale
    if (r.height > 0) {
      const newH = r.height * clampedY;
      if (newH < minSize) clampedY = minSize / r.height;
      if (newH > max) clampedY = Math.min(clampedY, max / r.height);
    }
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Scale a child rect from within `from` to within `to`.
 * The child is mapped proportionally from the source bounding box to the target.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
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
