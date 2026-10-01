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
 * Returns true if `inner` is entirely contained within `outer`.
 * Touching the edge from outside does NOT count as contained.
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
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Returns a normalized rect (positive width/height) from two corner points.
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
 * Resizes a rect from the given handle by the given delta (in world units).
 * The opposite corner/edge is the anchor.
 * If aspectLocked is true, the width-to-height ratio is preserved.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let newX = start.x;
  let newY = start.y;
  let newWidth = start.width;
  let newHeight = start.height;

  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle === 'n' || handle === 'ne' || handle === 'nw';
  const hasS = handle === 's' || handle === 'se' || handle === 'sw';

  if (hasE) {
    newWidth = start.width + delta.x;
  }
  if (hasW) {
    newWidth = start.width - delta.x;
    newX = start.x + delta.x;
  }
  if (hasS) {
    newHeight = start.height + delta.y;
  }
  if (hasN) {
    newHeight = start.height - delta.y;
    newY = start.y + delta.y;
  }

  // Ensure minimum positive size
  if (newWidth < 1) newWidth = 1;
  if (newHeight < 1) newHeight = 1;

  if (aspectLocked) {
    const scaleX = newWidth / start.width;
    const scaleY = newHeight / start.height;
    // Use the scale that gives the larger absolute change
    const scale = Math.max(scaleX, scaleY) >= 1
      ? Math.max(scaleX, scaleY)
      : Math.min(scaleX, scaleY);
    newWidth = Math.max(1, start.width * scale);
    newHeight = Math.max(1, start.height * scale);

    // Re-anchor based on handle
    if (hasW) {
      newX = start.x + start.width - newWidth;
    }
    if (hasN) {
      newY = start.y + start.height - newHeight;
    }
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Clamps a proposed scale so that no object's size goes below its minSize
 * or above maxSize. Returns the clamped scale as a Point ({x: scaleX, y: scaleY}).
 *
 * For each object i:
 *   - scale.x must be in [minSizes[i]/rects[i].width, maxSize/rects[i].width]
 *   - scale.y must be in [minSizes[i]/rects[i].height, maxSize/rects[i].height]
 *
 * The result is the most constrained scale that satisfies all objects.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (rects.length === 0) return scale;

  let minScaleX = 0;
  let maxScaleX = Infinity;
  let minScaleY = 0;
  let maxScaleY = Infinity;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i];

    if (r.width > 0) {
      minScaleX = Math.max(minScaleX, minSize / r.width);
      maxScaleX = Math.min(maxScaleX, maxSize / r.width);
    }
    if (r.height > 0) {
      minScaleY = Math.max(minScaleY, minSize / r.height);
      maxScaleY = Math.min(maxScaleY, maxSize / r.height);
    }
  }

  return {
    x: Math.min(Math.max(scale.x, minScaleX), maxScaleX),
    y: Math.min(Math.max(scale.y, minScaleY), maxScaleY),
  };
}

/**
 * Scales a child rect that was positioned within `from` to be positioned within `to`.
 * The child's relative position and size are scaled proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) {
    return { x: to.x, y: to.y, width: to.width, height: to.height };
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
