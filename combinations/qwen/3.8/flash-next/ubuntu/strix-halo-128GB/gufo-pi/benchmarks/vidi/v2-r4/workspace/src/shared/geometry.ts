/**
 * Pure geometry helpers for selection, resize and marquee logic.
 * All coordinates are in world units unless stated otherwise.
 */

import type { Point } from '../client/canvas/camera';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** True when `outer` fully contains `inner` (all four edges of inner lie inside outer). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Union (bounding box) of multiple rects. Returns null for an empty array. */
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

/** Normalize two screen points into a Rect (handles any drag direction). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resize a rect by dragging a handle. `delta` is the world-space delta of the
 * pointer. When `aspectLocked` is true, the aspect ratio is preserved.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;
  const endX = x + width;
  const endY = y + height;

  // Determine new edges from handle + delta
  let newLeft = x;
  let newRight = endX;
  let newTop = y;
  let newBottom = endY;

  if (handle.includes('w')) newLeft = x + delta.x;
  if (handle.includes('e')) newRight = endX + delta.x;
  if (handle.includes('n')) newTop = y + delta.y;
  if (handle.includes('s')) newBottom = endY + delta.y;

  let newWidth = newRight - newLeft;
  let newHeight = newBottom - newTop;

  if (aspectLocked) {
    // Determine which axis was primarily dragged to use as the reference
    const startRatio = width / height;
    const dx = Math.abs(delta.x);
    const dy = Math.abs(delta.y);

    // Use the axis with larger delta as reference
    let targetWidth: number, targetHeight: number;
    if (dx >= dy) {
      targetWidth = newWidth;
      targetHeight = newWidth / startRatio;
    } else {
      targetHeight = newHeight;
      targetWidth = newHeight * startRatio;
    }

    // Anchor from the opposite corner
    if (handle.includes('w')) {
      newLeft = newRight - targetWidth;
    } else if (handle.includes('e')) {
      // newLeft stays
    } else {
      // n or s: centred horizontally from anchor
      const cx = x + width / 2;
      newLeft = cx - targetWidth / 2;
    }

    if (handle.includes('n')) {
      newTop = newBottom - targetHeight;
    } else if (handle.includes('s')) {
      // newTop stays
    } else {
      // e or w: centred vertically from anchor
      const cy = y + height / 2;
      newTop = cy - targetHeight / 2;
    }

    newWidth = targetWidth;
    newHeight = targetHeight;
  }

  return { x: newLeft, y: newTop, width: newWidth, height: newHeight };
}

/**
 * Compute a scale factor (sx, sy) that when applied to each rect, no object
 * falls below its minSize or exceeds maxSize. Returns the clamped scale.
 *
 * `rects` and `minSizes` are parallel arrays.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let clampedSx = scale.x;
  let clampedSy = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;

    // Check width
    const newW = r.width * clampedSx;
    if (newW < min) {
      const s = min / r.width;
      if (s > clampedSx || clampedSx <= 0) clampedSx = s;
      // For negative scales, use the least restrictive
      if (clampedSx < 0) clampedSx = 0;
    }
    if (newW > maxSize) {
      const s = maxSize / r.width;
      if (s < clampedSx) clampedSx = s;
    }

    // Check height
    const newH = r.height * clampedSy;
    if (newH < min) {
      const s = min / r.height;
      if (s > clampedSy || clampedSy <= 0) clampedSy = s;
      if (clampedSy < 0) clampedSy = 0;
    }
    if (newH > maxSize) {
      const s = maxSize / r.height;
      if (s < clampedSy) clampedSy = s;
    }
  }

  return { x: clampedSx, y: clampedSy };
}

/**
 * Map `child` rect from being inside `from` to being inside `to`,
 * preserving relative position and scaling size proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width !== 0 ? to.width / from.width : 1;
  const sy = from.height !== 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
