// Pure geometry helpers for multi-selection transforms.
// Framework-free: no React, no DOM, no Yjs.

/** Axis-aligned rectangle in world coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen-space point (also used for world points). */
export interface Point {
  x: number;
  y: number;
}

/** The 8 resize handles around a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when `inner` lies fully inside `outer` (all four edges are at or within
 * the outer rect's boundaries).
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
 * The smallest rect containing all `rects`, or null if the array is empty.
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxR) maxR = r.x + r.width;
    if (r.y + r.height > maxB) maxB = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxR - minX, height: maxB - minY };
}

/**
 * Normalize two diagonal points into a Rect (the min corner is x,y).
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
 * Compute a new Rect after dragging a handle by `delta` screen-space world offset.
 * Edge handles change one axis; corner handles change both.
 * When `aspectLocked` is true, the ratio (width/height) is preserved from the
 * original rect, anchored from the opposite corner/edge.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  // Determine which edges move
  const moveLeft = handle === 'w' || handle === 'nw' || handle === 'sw';
  const moveRight = handle === 'e' || handle === 'ne' || handle === 'se';
  const moveTop = handle === 'n' || handle === 'nw' || handle === 'ne';
  const moveBottom = handle === 's' || handle === 'sw' || handle === 'se';

  if (moveLeft) {
    const newWidth = width - delta.x;
    x = x + delta.x;
    width = newWidth;
  }
  if (moveRight) {
    width = width + delta.x;
  }
  if (moveTop) {
    const newHeight = height - delta.y;
    y = y + delta.y;
    height = newHeight;
  }
  if (moveBottom) {
    height = height + delta.y;
  }

  if (aspectLocked) {
    const ratio = start.width / start.height;
    if (Number.isFinite(ratio) && ratio > 0) {
      // Determine which axis moved to drive the other
      const horizMoved = moveLeft || moveRight;
      const vertMoved = moveTop || moveBottom;

      if (horizMoved && vertMoved) {
        // Corner: use the larger relative change
        const scaleX = width / start.width;
        const scaleY = height / start.height;
        if (Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)) {
          height = width / ratio;
          // Adjust y for top-moving handles
          if (moveTop) {
            y = start.y + start.height - height;
          }
        } else {
          width = height * ratio;
          if (moveLeft) {
            x = start.x + start.width - width;
          }
        }
      } else if (horizMoved) {
        const newHeight = width / ratio;
        if (moveTop) {
          y = start.y + start.height - newHeight;
        }
        height = newHeight;
      } else if (vertMoved) {
        const newWidth = height * ratio;
        if (moveLeft) {
          x = start.x + start.width - newWidth;
        }
        width = newWidth;
      }
    }
  }

  return { x, y, width, height };
}

/**
 * Given a proposed scale factor (scaleX, scaleY), a set of current rects,
 * their per-type minSizes, and a global maxSize, return the largest uniform
 * scale that does not cause any object to go below its minSize or above maxSize.
 *
 * Returns a Point { x: scaleX, y: scaleY } where both are the same value
 * (uniform scaling) clamped as needed.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return { x: scale.x, y: scale.y };

  let clampedX = scale.x;
  let clampedY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;

    // Clamp against max size (growing)
    if (clampedX > 1) {
      const newW = r.width * clampedX;
      if (newW > maxSize) {
        clampedX = maxSize / r.width;
      }
    }
    // Clamp against min size (shrinking)
    if (clampedX < 1) {
      const newW = r.width * clampedX;
      if (newW < minSize) {
        clampedX = minSize / r.width;
      }
    }
    if (clampedY > 1) {
      const newH = r.height * clampedY;
      if (newH > maxSize) {
        clampedY = maxSize / r.height;
      }
    }
    if (clampedY < 1) {
      const newH = r.height * clampedY;
      if (newH < minSize) {
        clampedY = minSize / r.height;
      }
    }
  }

  // Use the most restrictive (smallest positive) scale for uniform scaling
  // We want the scale closest to 1 that doesn't violate constraints
  const finalX = Math.min(clampedX, clampedY);
  const finalY = finalX;

  return { x: finalX, y: finalY };
}

/**
 * Scale a child rect within a bounding box. The child's position and size are
 * remapped from the `from` bounding rect to the `to` bounding rect.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
