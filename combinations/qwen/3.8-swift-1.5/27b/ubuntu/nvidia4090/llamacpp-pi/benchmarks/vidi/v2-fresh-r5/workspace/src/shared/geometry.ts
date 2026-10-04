/**
 * Pure geometry helpers for the board. No DOM, no React imports.
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
 * Returns true if `inner` is fully contained within `outer`.
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
 * Returns the union (bounding) rectangle of all given rects,
 * or null if the array is empty.
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
    const rMaxX = r.x + r.width;
    const rMaxY = r.y + r.height;
    if (rMaxX > maxX) maxX = rMaxX;
    if (rMaxY > maxY) maxY = rMaxY;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Given two points, return the axis-aligned rectangle they define
 * (normalised so x,y is top-left and width/height are positive).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize a rectangle by dragging a handle. `delta` is in world units.
 * If `aspectLocked` is true, the aspect ratio of the starting rect is preserved.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  const dx = delta.x;
  const dy = delta.y;

  // Determine which edges move based on the handle
  const left = handle.includes('w');
  const right = handle.includes('e');
  const top = handle.includes('n');
  const bottom = handle.includes('s');

  let newWidth = width;
  let newHeight = height;
  let newX = x;
  let newY = y;

  if (left) {
    newX = x + dx;
    newWidth = width - dx;
  }
  if (right) {
    newWidth = width + dx;
  }
  if (top) {
    newY = y + dy;
    newHeight = height - dy;
  }
  if (bottom) {
    newHeight = height + dy;
  }

  // For edge handles (single axis), only that axis changes
  if (!left && !right) {
    newX = x;
    newWidth = width;
  }
  if (!top && !bottom) {
    newY = y;
    newHeight = height;
  }

  // Aspect lock: constrain to the original ratio using the dominant scale
  if (aspectLocked && start.width > 0 && start.height > 0) {
    const scaleX = newWidth / start.width;
    const scaleY = newHeight / start.height;
    // Use the dominant (larger magnitude) scale to preserve user intent
    const scale = Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY;
    newWidth = start.width * scale;
    newHeight = start.height * scale;
    // Re-anchor based on which edges are moving
    if (left) {
      newX = x + width - newWidth;
    }
    if (top) {
      newY = y + height - newHeight;
    }
  }

  // Prevent negative dimensions (clamp to 0 minimum)
  if (newWidth < 0) {
    if (left) newX = x + width;
    newWidth = 0;
  }
  if (newHeight < 0) {
    if (top) newY = y + height;
    newHeight = 0;
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Clamp a scale factor so that no rect, when scaled, would have any dimension
 * below its `minSize` or above `maxSize`. Returns the clamped { x, y } scale.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let clampedX = scale.x;
  let clampedY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minS = minSizes[i];

    // Width constraints
    if (r.width > 0) {
      const maxScaleX = maxSize / r.width;
      const minScaleX = minS / r.width;
      if (clampedX > maxScaleX) clampedX = maxScaleX;
      if (clampedX < minScaleX) clampedX = minScaleX;
    }
    // Height constraints
    if (r.height > 0) {
      const maxScaleY = maxSize / r.height;
      const minScaleY = minS / r.height;
      if (clampedY > maxScaleY) clampedY = maxScaleY;
      if (clampedY < minScaleY) clampedY = minScaleY;
    }
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Scale a child rect within a parent rect that is being resized from `from` to `to`.
 * The child's position and size are scaled proportionally.
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
