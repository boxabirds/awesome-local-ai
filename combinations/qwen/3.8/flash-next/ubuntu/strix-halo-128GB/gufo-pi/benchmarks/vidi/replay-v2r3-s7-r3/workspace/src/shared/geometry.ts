/**
 * Pure geometry utilities for selection, resize and marquee (story 7).
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

/** True when `inner` lies entirely inside `outer` (touching edges counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Bounding box of multiple rects; null for empty input. */
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

/** Normalize two screen/world points into a rect (handles any drag direction). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resize a rect by dragging a handle. The anchor is the opposite corner/edge.
 * `aspectLocked` keeps the original width-to-height ratio.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine new dimensions based on handle direction
  let newX = x, newY = y, newW = width, newH = height;

  // East/West affects x and width
  if (handle.includes('e')) {
    newW = width + delta.x;
  } else if (handle.includes('w')) {
    newW = width - delta.x;
    newX = x + delta.x;
  }

  // South/North affects y and height
  if (handle.includes('s')) {
    newH = height + delta.y;
  } else if (handle.includes('n')) {
    newH = height - delta.y;
    newY = y + delta.y;
  }

  if (aspectLocked) {
    const origRatio = width / height;
    if (origRatio === 0 || !Number.isFinite(origRatio)) {
      return start;
    }

    // Determine which axis had more relative change and use that
    const scaleX = newW / width;
    const scaleY = newH / height;

    // For corner handles, use the dominant scale
    const isCorner = handle.length === 2;
    let finalScale: number;
    if (isCorner) {
      // Use the larger absolute scale change
      if (Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)) {
        finalScale = scaleX;
      } else {
        finalScale = scaleY;
      }
    } else if (handle === 'e' || handle === 'w') {
      finalScale = scaleX;
    } else {
      finalScale = scaleY;
    }

    newW = width * finalScale;
    newH = height * finalScale;

    // Adjust position to keep the anchor fixed
    if (handle.includes('w')) {
      newX = x + width - newW;
    }
    if (handle.includes('n')) {
      newY = y + height - newH;
    }
  }

  // Ensure positive dimensions (clamp to 0 minimum, caller handles min size)
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
 * Compute a clamped uniform scale factor such that no object in `rects` (each
 * with its corresponding `minSizes[i]`) would go below its minimum or above `maxSize`.
 * Returns a Point { x: scaleX, y: scaleY } — for aspect-locked use the min of both.
 *
 * The returned scale is the single most restrictive scale that keeps all objects
 * within bounds. If scale is already valid, returns it unchanged.
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
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;

    // Clamp scale so width doesn't go below minSize or above maxSize
    if (r.width > 0) {
      const minScaleX = minSize / r.width;
      const maxScaleX = maxSize / r.width;
      clampedX = Math.max(clampedX, minScaleX);
      clampedX = Math.min(clampedX, maxScaleX);
    }
    if (r.height > 0) {
      const minScaleY = minSize / r.height;
      const maxScaleY = maxSize / r.height;
      clampedY = Math.max(clampedY, minScaleY);
      clampedY = Math.min(clampedY, maxScaleY);
    }
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Map a child rect from within a source bounding box to a destination bounding box,
 * preserving relative position and size proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
