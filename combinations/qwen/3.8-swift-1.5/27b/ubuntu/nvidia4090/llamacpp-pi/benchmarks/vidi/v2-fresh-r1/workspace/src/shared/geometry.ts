// Shared geometry helpers for group selection, move and resize (story 7).
// Pure functions only — no Yjs, no React.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when every edge of `inner` is inside (or on the boundary of) `outer`.
 * A rect touching the boundary from the outside (i.e. extending past it) is
 * NOT contained.
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
 * Union (bounding) rect of a list of rects. Returns null for an empty list.
 */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Axis-aligned rect between two arbitrary points (marquee / drag rectangle).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resize `start` by moving `handle` by `delta` (world units).
 * The opposite edge/corner stays anchored. When `aspectLocked` is true the
 * start rect's width/height ratio is preserved: the axis with the larger
 * absolute delta decides the new size, the other axis is derived from the
 * ratio. For a single-axis (edge) handle with aspect lock, the derived axis
 * grows from the centre of the start rect.
 * Non-finite input returns `start` unchanged.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (
    !Number.isFinite(start.width) || !Number.isFinite(start.height) ||
    !Number.isFinite(delta.x) || !Number.isFinite(delta.y)
  ) {
    return start;
  }

  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

  let width: number;
  let height: number;

  if (!aspectLocked) {
    width = start.width + sx * delta.x;
    height = start.height + sy * delta.y;
  } else {
    const ratio = start.height !== 0 ? start.width / start.height : 1;
    const xFree = sx !== 0 ? start.width + sx * delta.x : null;
    const yFree = sy !== 0 ? start.height + sy * delta.y : null;
    if (xFree !== null && yFree !== null) {
      // Corner: the axis with the larger movement decides.
      if (Math.abs(delta.x) >= Math.abs(delta.y)) {
        width = xFree;
        height = ratio !== 0 ? width / ratio : 0;
      } else {
        height = yFree;
        width = height * ratio;
      }
    } else if (xFree !== null) {
      // 'e' / 'w' edge: width decides, height derived.
      width = xFree;
      height = ratio !== 0 ? width / ratio : 0;
    } else if (yFree !== null) {
      // 'n' / 's' edge: height decides, width derived.
      height = yFree;
      width = height * ratio;
    } else {
      width = start.width;
      height = start.height;
    }
  }

  // Anchor: the opposite edge/corner stays fixed. For a single-axis handle
  // with a derived (locked) other axis, that axis grows from the centre.
  let x = start.x;
  let y = start.y;
  if (sx === -1) {
    x = start.x + (start.width - width);
  }
  if (sy === -1) {
    y = start.y + (start.height - height);
  }
  if (sx === 0 && aspectLocked && width !== start.width) {
    x = start.x - (width - start.width) / 2;
  }
  if (sy === 0 && aspectLocked && height !== start.height) {
    y = start.y - (height - start.height) / 2;
  }

  return { x, y, width, height };
}

/**
 * Clamp a per-axis scale factor so that no rect in `rects` ends up smaller
 * than its corresponding entry in `minSizes` or larger than `maxSize` in
 * either dimension. Returns the clamped scale.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  let minX = 0;
  let maxX = Infinity;
  let minY = 0;
  let maxY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      minX = Math.max(minX, min / r.width);
      maxX = Math.min(maxX, maxSize / r.width);
    }
    if (r.height > 0) {
      minY = Math.max(minY, min / r.height);
      maxY = Math.min(maxY, maxSize / r.height);
    }
  }
  const cx = Number.isFinite(scale.x) ? Math.min(Math.max(scale.x, minX), maxX) : 1;
  const cy = Number.isFinite(scale.y) ? Math.min(Math.max(scale.y, minY), maxY) : 1;
  return { x: cx, y: cy };
}

/**
 * Rescale `child` (positioned in `from`'s coordinate space) into `to`.
 * Used to keep the relative layout of the objects inside a selection box
 * while the box itself is resized.
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
