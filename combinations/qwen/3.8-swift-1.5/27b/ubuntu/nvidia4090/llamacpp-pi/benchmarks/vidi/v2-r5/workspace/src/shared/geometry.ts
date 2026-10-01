// src/shared/geometry.ts
// Pure geometry utilities for selection bounding boxes and transforms.

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
 * Returns true if `inner` lies entirely within `outer`.
 * All four edges of `inner` must be strictly inside or on the boundary of `outer`.
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
 * Returns the union (bounding) rect of all given rects.
 * Returns null if the array is empty.
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Normalizes two points into a rect (handles negative width/height from dragging).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Resizes a rect by dragging a handle.
 * `delta` is the pointer movement in world units from the start of the drag.
 * If `aspectLocked` is true, the rect maintains its width/height ratio.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');

  let dx = delta.x;
  let dy = delta.y;

  if (hasW) {
    x = start.x + dx;
    width = start.width - dx;
  }
  if (hasE) {
    width = start.width + dx;
  }
  if (hasN) {
    y = start.y + dy;
    height = start.height - dy;
  }
  if (hasS) {
    height = start.height + dy;
  }

  // Clamp to minimum 1 to avoid negative/zero sizes
  if (width < 1) {
    if (hasW) x = start.x + start.width - 1;
    width = 1;
  }
  if (height < 1) {
    if (hasN) y = start.y + start.height - 1;
    height = 1;
  }

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    // Determine the dominant axis change
    if (hasW || hasE) {
      // Width is the primary axis
      const newHeight = width / ratio;
      if (newHeight > 0) {
        if (hasN) y = start.y + start.height - newHeight;
        height = newHeight;
      }
    } else {
      // Height is the primary axis
      const newWidth = height * ratio;
      if (newWidth > 0) {
        if (hasW) x = start.x + start.width - newWidth;
        width = newWidth;
      }
    }
  }

  return { x, y, width, height };
}

/**
 * Clamps a scale factor so that no child rect, when scaled, would go below its
 * minSize or above maxSize. Returns the clamped uniform scale {sx, sy}.
 *
 * `scale` is the proposed scale {sx, sy}.
 * `rects` are the child rects in the bounding box.
 * `minSizes` are the per-rect minimum sizes.
 * `maxSize` is the global maximum size for any dimension.
 */
export function clampScale(scale: { sx: number; sy: number }, rects: Rect[], minSizes: number[], maxSize: number): { sx: number; sy: number } {
  let sx = scale.sx;
  let sy = scale.sy;

  // If scale is non-positive or non-finite, return identity
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
    return { sx: 1, sy: 1 };
  }

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minS = minSizes[i];

    const newW = r.width * sx;
    const newH = r.height * sy;

    // Clamp width: must be >= minS and <= maxSize
    if (newW < minS) {
      const clamped = minS / r.width;
      if (clamped > sx) sx = clamped;
    }
    if (newW > maxSize) {
      const clamped = maxSize / r.width;
      if (clamped < sx) sx = clamped;
    }

    // Clamp height: must be >= minS and <= maxSize
    if (newH < minS) {
      const clamped = minS / r.height;
      if (clamped > sy) sy = clamped;
    }
    if (newH > maxSize) {
      const clamped = maxSize / r.height;
      if (clamped < sy) sy = clamped;
    }
  }

  return { sx, sy };
}

/**
 * Scales a child rect within a bounding box transformation.
 * Given the `from` bounding box and the `to` bounding box, compute the new
 * position and size of `child` (which was within `from`).
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) {
    return { x: to.x, y: to.y, width: child.width, height: child.height };
  }

  const sx = to.width / from.width;
  const sy = to.height / from.height;

  const newX = to.x + (child.x - from.x) * sx;
  const newY = to.y + (child.y - from.y) * sy;
  const newWidth = child.width * sx;
  const newHeight = child.height * sy;

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}
