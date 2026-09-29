/**
 * Pure geometry helpers for selection, resizing and the marquee.
 *
 * All coordinates are world units. Screen-to-world conversion is done by the
 * callers (the gesture hooks and viewport) using the camera functions in
 * `camera.ts`.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface Point {
  x: number;
  y: number;
}

/** True when `inner` lies entirely inside `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect enclosing all given rects; null for empty input. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    const rx = r.x + r.width;
    const ry = r.y + r.height;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Normalize two points into a well-formed Rect (positive width/height). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resize a rect by dragging a handle.
 *
 * `delta` is the pointer movement in world units. The anchor is the opposite
 * corner/edge from the handle. `aspectLocked` forces the aspect ratio to be
 * preserved (sticky notes, or Shift held).
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine new width/height from delta.
  let dw = 0;
  let dh = 0;

  if (handle.includes('e')) dw = delta.x;
  else if (handle.includes('w')) dw = -delta.x;

  if (handle.includes('s')) dh = delta.y;
  else if (handle.includes('n')) dh = -delta.y;

  let newWidth = width + dw;
  let newHeight = height + dh;

  // Aspect lock: keep the ratio from the original size.
  if (aspectLocked && width > 0 && height > 0) {
    const aspectRatio = width / height;
    // Pick the dominant axis change.
    if (handle.length === 1) {
      // Edge handle: single axis, so derive the other from ratio.
      if (handle === 'e' || handle === 'w') {
        newHeight = newWidth / aspectRatio;
      } else {
        newWidth = newHeight * aspectRatio;
      }
    } else {
      // Corner handle: use the larger magnitude to maintain ratio.
      const scaleX = width !== 0 ? newWidth / width : 1;
      const scaleY = height !== 0 ? newHeight / height : 1;
      const scale = Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY;
      newWidth = width * scale;
      newHeight = height * scale;
    }
  }

  // Adjust position for handles on left or top edges.
  if (handle.includes('w')) {
    x = start.x + start.width - newWidth;
  }
  if (handle.includes('n')) {
    y = start.y + start.height - newHeight;
  }

  return { x, y, width: newWidth, height: newHeight };
}

/**
 * Clamp a scale factor so no object goes below its minSize or above maxSize.
 *
 * `scale` is the desired scale factor (x and y independently).
 * `rects` are the current rects of selected objects.
 * `minSizes` is the minimum size for each rect (by type).
 * Returns the clamped uniform scale, or the original if nothing clamps.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let sx = scale.x;
  let sy = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;

    // Shrink clamp: don't go below minSize. Raise the scale to the smallest
    // value that keeps both axes at or above the minimum.
    if (r.width > 0 && r.width * sx < minSize) sx = minSize / r.width;
    if (r.height > 0 && r.height * sy < minSize) sy = minSize / r.height;

    // Grow clamp: don't exceed maxSize.
    if (r.width > 0 && r.width * sx > maxSize) {
      const maxGrow = maxSize / r.width;
      if (maxGrow < sx) sx = maxGrow;
    }
    if (r.height > 0 && r.height * sy > maxSize) {
      const maxGrow = maxSize / r.height;
      if (maxGrow < sy) sy = maxGrow;
    }
  }

  return { x: sx, y: sy };
}

/**
 * Scale a child rect from its parent bounding box to a new bounding box.
 *
 * The child's position and size are interpolated within the parent's frame:
 * the fractional position within the parent is preserved, and size is scaled
 * proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const fromW = from.width || 1;
  const fromH = from.height || 1;
  const scaleX = (to.width || 0) / fromW;
  const scaleY = (to.height || 0) / fromH;

  // Relative position of child within the parent bounding box.
  const rx = (child.x - from.x) / fromW;
  const ry = (child.y - from.y) / fromH;

  return {
    x: to.x + rx * to.width,
    y: to.y + ry * to.height,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
