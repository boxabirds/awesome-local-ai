import type { Point } from '../client/canvas/camera';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Check if `inner` is completely inside (or touching) `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Return a rect that contains all input rects, or null if empty. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    const right = r.x + r.width;
    const bottom = r.y + r.height;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Normalise two points into a proper Rect (x/y are min corner). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Resize a rect by dragging a handle by `delta`, with optional aspect lock. */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  const sx = start.x;
  const sy = start.y;
  const sw = start.width;
  const sh = start.height;

  let nx = sx;
  let ny = sy;
  let nw = sw;
  let nh = sh;

  switch (handle) {
    case 'nw':
      nx = sx + delta.x;
      ny = sy + delta.y;
      nw = sw - delta.x;
      nh = sh - delta.y;
      break;
    case 'n':
      ny = sy + delta.y;
      nh = sh - delta.y;
      break;
    case 'ne':
      ny = sy + delta.y;
      nw = sw + delta.x;
      nh = sh - delta.y;
      break;
    case 'e':
      nw = sw + delta.x;
      break;
    case 'se':
      nw = sw + delta.x;
      nh = sh + delta.y;
      break;
    case 's':
      nh = sh + delta.y;
      break;
    case 'sw':
      nx = sx + delta.x;
      nw = sw - delta.x;
      nh = sh + delta.y;
      break;
    case 'w':
      nx = sx + delta.x;
      nw = sw - delta.x;
      break;
  }

  // Aspect lock: adjust dimension opposite to drag direction
  if (aspectLocked) {
    const aspect = sw / sh;
    if ((handle === 'n' || handle === 's') && sh !== 0) {
      nw = nh * aspect;
    } else if ((handle === 'e' || handle === 'w') && sw !== 0) {
      nh = nw / aspect;
    }
    // Corners keep ratio already satisfied by adjusting one dimension after both changed
    if (handle === 'ne' || handle === 'se') {
      nh = nw / aspect;
    } else if (handle === 'nw' || handle === 'sw') {
      nh = nw / aspect;
    }
  }

  return { x: nx, y: ny, width: nw, height: nh };
}

/** Clamp a scale factor so no object exceeds minSize or maxSize. */
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
    const min = minSizes[i] ?? STICKY_MIN_SIZE_WORLD;

    // Scale down limit (minimum size): newW = r.w * sx
    if (sx > 0 && r.width * sx < min) {
      sx = Math.max(sx, min / r.width);
    }
    if (sy > 0 && r.height * sy < min) {
      sy = Math.max(sy, min / r.height);
    }

    // Scale up limit (maximum size)
    if (sx > 0 && r.width * sx > maxSize) {
      sx = Math.min(sx, maxSize / r.width);
    }
    if (sy > 0 && r.height * sy > maxSize) {
      sy = Math.min(sy, maxSize / r.height);
    }
  }

  return { x: sx, y: sy };
}

/** Position and size a child object so it maps its bounding box (`from`) to `to`. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return { ...child };
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  const cx = child.x - from.x;
  const cy = child.y - from.y;
  return {
    x: to.x + cx * scaleX,
    y: to.y + cy * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}

// Keep a reference to STICKY_MIN_SIZE_WORLD to avoid import cycle
const STICKY_MIN_SIZE_WORLD = 50;
