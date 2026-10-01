/**
 * Pure geometry helpers for selection, marquee and group transform.
 *
 * All coordinates are in world units unless stated otherwise. Functions are pure and
 * never throw: non-finite inputs return neutral values (null, zero-scale, etc.).
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

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isValidRect = (r: Rect): boolean =>
  isFiniteNumber(r.x) && isFiniteNumber(r.y) && isFiniteNumber(r.width) && isFiniteNumber(r.height);

/** True when `inner` lies entirely inside `outer` (touching edges counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isValidRect(outer) || !isValidRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Union (bounding box) of an array of rects; null for empty input. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    if (!isValidRect(r)) continue;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Normalize two arbitrary screen points into a proper Rect (positive width/height).
 * Used by the marquee where the user might drag in any direction.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resize a rect by dragging a handle by `delta` (world units).
 *
 * - Corner handles resize from the opposite corner; edge handles resize one axis only.
 * - When `aspectLocked` is true, the aspect ratio of the start rect is maintained.
 * - Returns a rect with non-negative width/height.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isValidRect(start) || !isFiniteNumber(delta.x) || !isFiniteNumber(delta.y))
    return { ...start };

  let { x, y, width, height } = start;
  const right = x + width;
  const bottom = y + height;

  // Compute new edges based on handle
  let newLeft = x;
  let newTop = y;
  let newRight = right;
  let newBottom = bottom;

  if (handle.includes('w')) newLeft = x + delta.x;
  if (handle.includes('e')) newRight = right + delta.x;
  if (handle.includes('n')) newTop = y + delta.y;
  if (handle.includes('s')) newBottom = bottom + delta.y;

  // Edge-only handles constrain the other axis
  if (handle === 'n' || handle === 's') {
    newLeft = x;
    newRight = right;
  }
  if (handle === 'e' || handle === 'w') {
    newTop = y;
    newBottom = bottom;
  }

  let newWidth = Math.max(0, newRight - newLeft);
  let newHeight = Math.max(0, newBottom - newTop);
  let newX: number;
  let newY: number;

  // Determine anchor point (the fixed corner/edge)
  const anchorX = handle.includes('w') ? right : x;
  const anchorY = handle.includes('n') ? bottom : y;

  if (aspectLocked && width > 0 && height > 0) {
    // Compute scale factor from the primary axis of the handle
    let scale = 1;
    if (handle === 'n' || handle === 's') {
      scale = newHeight / height;
    } else if (handle === 'e' || handle === 'w') {
      scale = newWidth / width;
    } else {
      // Corner: use the larger scale (dominant axis)
      const scaleX = handle.includes('e') || handle.includes('w') ? newWidth / width : 1;
      const scaleY = handle.includes('n') || handle.includes('s') ? newHeight / height : 1;
      // Use the scale that gives the largest uniform scale (absolute deviation from 1)
      scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    }
    scale = Math.max(0, scale);
    newWidth = width * scale;
    newHeight = height * scale;
  }

  // Position from anchor
  if (handle.includes('w')) {
    newX = anchorX - newWidth;
  } else if (handle.includes('e')) {
    newX = anchorX;
  } else {
    // n or s: keep x centered or just keep left
    newX = x;
  }

  if (handle.includes('n')) {
    newY = anchorY - newHeight;
  } else if (handle.includes('s')) {
    newY = anchorY;
  } else {
    // e or w: keep y
    newY = y;
  }

  return { x: newX, y: newY, width: Math.max(0, newWidth), height: Math.max(0, newHeight) };
}

/**
 * Clamp a uniform scale (dx, dy) so that no rect in `rects` would exceed its `minSizes[i]`
 * on either axis or exceed `maxSize` on either axis after being scaled from its current size.
 *
 * Returns a clamped { x, y } scale vector (each component in (0, maxSize/minMinSize]).
 * For aspect-locked situations the caller passes equal x and y and gets a uniform clamp.
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
    const r = rects[i]!;
    const min = minSizes[i] ?? 0;

    // Minimum: newWidth = r.width * scale >= min => scale >= min / r.width
    if (r.width > 0) {
      const minScaleX = min / r.width;
      if (clampedX < minScaleX) clampedX = minScaleX;
    }
    if (r.height > 0) {
      const minScaleY = min / r.height;
      if (clampedY < minScaleY) clampedY = minScaleY;
    }

    // Maximum: newWidth = r.width * scale <= maxSize => scale <= maxSize / r.width
    if (r.width > 0) {
      const maxScaleX = maxSize / r.width;
      if (clampedX > maxScaleX) clampedX = maxScaleX;
    }
    if (r.height > 0) {
      const maxScaleY = maxSize / r.height;
      if (clampedY > maxScaleY) clampedY = maxScaleY;
    }
  }

  return { x: Math.max(0, clampedX), y: Math.max(0, clampedY) };
}

/**
 * Scale a child rect from within a `from` bounding box to fit within a `to` bounding box.
 *
 * Computes proportional position and size mapping: the child's offset and size relative to
 * the from-box are scaled to the to-box dimensions.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isValidRect(child) || !isValidRect(from) || !isValidRect(to))
    return { ...child };
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
