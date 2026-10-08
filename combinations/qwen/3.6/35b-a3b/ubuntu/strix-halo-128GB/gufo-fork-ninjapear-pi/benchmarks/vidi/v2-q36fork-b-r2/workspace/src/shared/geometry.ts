import { STICKY_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from './config';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Compute world-space bounding rect for an object with optional width/height. */
export function objectBounds(obj: { x: number; y: number; width?: number; height?: number }): Rect {
  const w = (obj.width !== undefined && Number.isFinite(obj.width)) ? obj.width : 200;
  const h = (obj.height !== undefined && Number.isFinite(obj.height)) ? obj.height : 200;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/**
 * Check if `inner` is fully contained within `outer`.
 * All four edges of inner must lie inside outer.
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
 * Compute the union bounding box of an array of rects.
 * Returns null for empty input.
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
 * Normalize a rect so width and height are non-negative.
 * Given two points, returns the rect in world coords.
 */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize a rect by dragging a handle with delta.
 * When aspectLocked is true, maintains the original width-to-height ratio.
 * Applies minSize/maxSize constraints when clampToSize is true.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: { x: number; y: number },
  aspectLocked: boolean,
  minSize: number = STICKY_MIN_SIZE_WORLD,
  maxSize: number = MAX_OBJECT_SIZE_WORLD,
): Rect {
  // Compute raw new dimensions based on handle
  let newX = start.x;
  let newY = start.y;
  let newWidth = start.width;
  let newHeight = start.height;

  switch (handle) {
    case 'nw':
      newX = start.x + delta.x;
      newY = start.y + delta.y;
      newWidth = start.width - delta.x;
      newHeight = start.height - delta.y;
      break;
    case 'n':
      newY = start.y + delta.y;
      newHeight = start.height - delta.y;
      break;
    case 'ne':
      newY = start.y + delta.y;
      newWidth = start.width + delta.x;
      newHeight = start.height - delta.y;
      break;
    case 'e':
      newWidth = start.width + delta.x;
      break;
    case 'se':
      newWidth = start.width + delta.x;
      newHeight = start.height + delta.y;
      break;
    case 's':
      newHeight = start.height + delta.y;
      break;
    case 'sw':
      newX = start.x + delta.x;
      newWidth = start.width - delta.x;
      newHeight = start.height + delta.y;
      break;
    case 'w':
      newX = start.x + delta.x;
      newWidth = start.width - delta.x;
      break;
  }

  // Clamp dimensions to min/max
  newWidth = Math.max(minSize, Math.min(maxSize, newWidth));
  newHeight = Math.max(minSize, Math.min(maxSize, newHeight));

  if (aspectLocked) {
    // Maintain aspect ratio from original
    const aspect = start.width / start.height;
    if (newWidth / newHeight > aspect) {
      // Width dominates — constrain by width
      newHeight = newWidth / aspect;
    } else {
      // Height dominates — constrain by height
      newWidth = newHeight * aspect;
    }
    // Re-clamp after aspect adjustment
    newWidth = Math.max(minSize, Math.min(maxSize, newWidth));
    newHeight = Math.max(minSize, Math.min(maxSize, newHeight));
    if (newWidth / newHeight > aspect) {
      newHeight = newWidth / aspect;
    } else {
      newWidth = newHeight * aspect;
    }

    // Recalculate position keeping the anchor point fixed
    const anchorX = handle.includes('w') ? start.x + start.width : start.x;
    const anchorY = handle.includes('n') ? start.y + start.height : start.y;

    switch (handle) {
      case 'nw':
        newX = anchorX - newWidth;
        newY = anchorY - newHeight;
        break;
      case 'n':
        newY = anchorY - newHeight;
        break;
      case 'ne':
        newY = anchorY - newHeight;
        break;
      case 'e':
        break;
      case 'se':
        break;
      case 's':
        break;
      case 'sw':
        newX = anchorX - newWidth;
        break;
      case 'w':
        newX = anchorX - newWidth;
        break;
    }
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Clamp scale factor so no object crosses minSize or maxSize limits.
 * Returns a single uniform scale applied to the whole selection.
 */
export function clampScale(
  scale: { x: number; y: number },
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): { x: number; y: number } {
  if (rects.length === 0) return scale;

  let clampedX = scale.x;
  let clampedY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? STICKY_MIN_SIZE_WORLD;

    // Upper bound: each dimension can't exceed maxSize
    const scaleXMax = maxSize / r.width;
    const scaleYMax = maxSize / r.height;
    clampedX = Math.min(clampedX, scaleXMax);
    clampedY = Math.min(clampedY, scaleYMax);

    // Lower bound: each dimension can't go below minSize
    const scaleXMin = minSize / r.width;
    const scaleYMin = minSize / r.height;
    clampedX = Math.max(clampedX, scaleXMin);
    clampedY = Math.max(clampedY, scaleYMin);
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Scale a child rect from `from` bounding box to `to` bounding box.
 * The child maintains its relative position and size within the box.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return { ...child };

  const ratioW = to.width / from.width;
  const ratioH = to.height / from.height;

  // Relative position within from box
  const relX = (child.x - from.x) / from.width;
  const relY = (child.y - from.y) / from.height;
  // Relative size
  const relW = child.width / from.width;
  const relH = child.height / from.height;

  return {
    x: to.x + relX * to.width,
    y: to.y + relY * to.height,
    width: relW * to.width,
    height: relH * to.height,
  };
}
