import { Point } from '@client/canvas/camera';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Returns true if `inner` is entirely inside `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Returns the union bounding box of multiple rects, or null for empty input. */
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

/** Normalizes two points into a rect (handles negative drag directions). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return { x, y, width, height };
}

/**
 * Resize a rect by dragging a handle. The delta is in world units.
 * Edge handles change one axis; corner handles change both.
 * When aspectLocked is true, the width-to-height ratio is maintained.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine which axes are affected
  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');

  // Determine direction: handles on left/top negate the delta
  const dx = handle.includes('w') ? -delta.x : delta.x;
  const dy = handle.includes('n') ? -delta.y : delta.y;

  let newWidth = width;
  let newHeight = height;
  let newX = x;
  let newY = y;

  if (affectsX) {
    newWidth = width + dx;
    if (handle.includes('w')) newX = x - dx;
  }
  if (affectsY) {
    newHeight = height + dy;
    if (handle.includes('n')) newY = y - dy;
  }

  // Prevent negative dimensions
  if (newWidth <= 0) {
    if (handle.includes('w')) newX = x + width;
    newWidth = 0;
  }
  if (newHeight <= 0) {
    if (handle.includes('n')) newY = y + height;
    newHeight = 0;
  }

  if (aspectLocked) {
    // Maintain aspect ratio from the original
    const startRatio = start.width / start.height || 1;

    if (affectsX && affectsY) {
      // Corner handle: use the larger change
      const ratioW = newWidth / start.width;
      const ratioH = newHeight / start.height;
      const ratio = Math.abs(ratioW - 1) >= Math.abs(ratioH - 1) ? ratioW : ratioH;
      newWidth = start.width * ratio;
      newHeight = newWidth / startRatio;
    } else if (affectsX) {
      newHeight = newWidth / startRatio;
    } else {
      newWidth = newHeight * startRatio;
    }

    // Recompute position based on handle
    if (handle.includes('w')) newX = x + width - newWidth;
    if (handle.includes('n')) newY = y + height - newHeight;
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Compute a uniform scale factor (single number) that prevents any object from
 * going below its minSize or above maxSize. Returns { x, y } with the clamped
 * scale applied uniformly (both axes are the same to preserve relative layout).
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return scale;

  // We use a uniform scale: min of scale.x and scale.y
  let s = Math.min(scale.x, scale.y);

  // Find the minimum allowed scale (from minSizes)
  let minScale = 0;
  for (let i = 0; i < rects.length; i++) {
    const minSize = i < minSizes.length ? minSizes[i] : 0;
    const r = rects[i];
    const minSx = minSize / r.width;
    const minSy = minSize / r.height;
    const minSR = Math.max(minSx, minSy);
    if (minSR > minScale) minScale = minSR;
  }

  // Find the maximum allowed scale (from maxSize)
  let maxScale = Infinity;
  for (const r of rects) {
    const maxSx = maxSize / r.width;
    const maxSy = maxSize / r.height;
    const maxSR = Math.min(maxSx, maxSy);
    if (maxSR < maxScale) maxScale = maxSR;
  }

  s = Math.max(minScale, Math.min(maxScale, s));

  return { x: s, y: s };
}

/**
 * Scale a child rect within a parent rect from one bounds to another.
 * Maps the child's position and size proportionally from `from` to `to`.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return child;

  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;

  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
