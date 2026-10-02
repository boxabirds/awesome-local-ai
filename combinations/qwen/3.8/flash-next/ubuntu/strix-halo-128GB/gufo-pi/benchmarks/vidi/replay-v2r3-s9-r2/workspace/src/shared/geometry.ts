/**
 * Pure geometry helpers for selection, resize and marquee (story 7).
 * All values are in world units unless stated otherwise.
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
 * Returns true when `inner` lies entirely inside `outer`.
 * Touching the edge from outside is NOT inside.
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
 * The smallest axis-aligned rect containing all given rects.
 * Returns null for an empty list.
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
 * Build a Rect from two corner points (any corners), normalizing so width/height >= 0.
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
 * Resize a rect by dragging the given handle by `delta` (world units).
 * If aspectLocked, maintain the original width-to-height ratio.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  // Determine new edges based on handle
  if (handle.includes('w')) {
    const newX = x + delta.x;
    width = width - delta.x;
    x = newX;
  }
  if (handle.includes('e')) {
    width = width + delta.x;
  }
  if (handle.includes('n')) {
    const newY = y + delta.y;
    height = height - delta.y;
    y = newY;
  }
  if (handle.includes('s')) {
    height = height + delta.y;
  }

  // Enforce minimum positive dimensions
  if (width <= 0) width = 1;
  if (height <= 0) height = 1;

  if (aspectLocked) {
    const ratio = start.width / start.height;
    // Determine the dominant axis change
    const scaleW = width / start.width;
    const scaleH = height / start.height;
    const scale = Math.max(scaleW, scaleH);
    const newW = start.width * scale;
    const newH = start.height * scale;

    // Adjust position based on which handle is being dragged
    if (handle.includes('w')) {
      x = start.x + start.width - newW;
    }
    if (handle.includes('n')) {
      y = start.y + start.height - newH;
    }

    width = newW;
    height = newH;
  }

  return { x, y, width, height };
}

/**
 * Compute a uniform scale factor (sx, sy) clamped so no object crosses
 * its minSize or maxSize. Returns the single scale applied to the whole selection.
 *
 * `rects` and `minSizes` are parallel arrays.
 * `maxSize` is the global maximum.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let clampedSx = scale.x;
  let clampedSy = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;

    // Width: ensure new width is at least min and at most maxSize
    if (r.width > 0) {
      const minScaleW = min / r.width;      // scale below which width < min
      const maxScaleW = maxSize / r.width;   // scale above which width > max
      if (clampedSx < minScaleW) clampedSx = minScaleW;
      if (clampedSx > maxScaleW) clampedSx = maxScaleW;
    }

    // Height: ensure new height is at least min and at most maxSize
    if (r.height > 0) {
      const minScaleH = min / r.height;
      const maxScaleH = maxSize / r.height;
      if (clampedSy < minScaleH) clampedSy = minScaleH;
      if (clampedSy > maxScaleH) clampedSy = maxScaleH;
    }
  }

  // For aspect-locked resize the caller passes sx === sy; we must clamp uniformly.
  if (scale.x === scale.y) {
    // Take the most restrictive value: max for min-constraints, min for max-constraints.
    // Since we already applied both, take the midpoint... actually for uniform we need
    // a single value. Use the most restrictive: max(sx,sy) for shrinking (larger is more
    // likely to exceed min), min(sx,sy) for growing (smaller is more likely within max).
    // Simple approach: take whichever value is more constrained.
    const s = (scale.x < 1)
      ? Math.max(clampedSx, clampedSy)   // shrinking: need at least the larger
      : Math.min(clampedSx, clampedSy);  // growing: need at most the smaller
    clampedSx = s;
    clampedSy = s;
  }

  return { x: clampedSx, y: clampedSy };
}

/**
 * Map a child rect within `from` to the corresponding location within `to`.
 * Used during group resize: each object's position and size are scaled proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return child;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
