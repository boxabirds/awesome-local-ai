import type { Point } from '@/client/canvas/camera';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * Returns true if every point of `inner` lies inside (or on the edge of) `outer`.
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
 * Returns the smallest rectangle that contains all given rects, or null if the list is empty.
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x = rects[0].x;
  let y = rects[0].y;
  let maxX = rects[0].x + rects[0].width;
  let maxY = rects[0].y + rects[0].height;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i];
    if (r.x < x) x = r.x;
    if (r.y < y) y = r.y;
    const right = r.x + r.width;
    const bottom = r.y + r.height;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { x, y, width: maxX - x, height: maxY - y };
}

/**
 * Normalises two points into a Rect regardless of order — always positive width/height.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return { x, y, width: w, height: h };
}

/**
 * Resizes `start` by applying `delta` relative to the handle grip.
 * Corner handles change both axes; edge handles change one axis only.
 * If `aspectLocked` is true, the width-to-height ratio is preserved from the opposite anchor.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Apply deltas based on handle position
  switch (handle) {
    case 'n':
      y += delta.y;
      height -= delta.y;
      break;
    case 'ne':
      width += delta.x;
      height += delta.y;
      break;
    case 'e':
      width += delta.x;
      break;
    case 'se':
      width += delta.x;
      height += delta.y;
      break;
    case 's':
      height += delta.y;
      break;
    case 'sw':
      x += delta.x;
      width -= delta.x;
      height += delta.y;
      break;
    case 'w':
      x += delta.x;
      width -= delta.x;
      break;
    case 'nw':
      x += delta.x;
      y += delta.y;
      width -= delta.x;
      height -= delta.y;
      break;
  }

  if (aspectLocked && width > 0 && height > 0) {
    const aspectRatio = start.width / start.height;
    // Preserve ratio from the opposite-anchor corner (the one NOT at the dragged handle)
    // For horizontal drag dominance: scale both width and height proportionally
    const newHeight = width / aspectRatio;
    height = newHeight;
  }

  return { x, y, width, height };
}

/**
 * Clamps a uniform scale factor so that no object crosses its minSize or maxSize.
 * Returns the largest valid scale (so objects grow as much as possible).
 * Each object must already be scaled to its expected size in `rects`.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let scaleX = scale.x;
  let scaleY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 50;

    // Maximum scale before exceeding MAX_OBJECT_SIZE_WORLD
    const maxScaleX = maxSize / (r.width || 1);
    const maxScaleY = maxSize / (r.height || 1);

    if (scaleX > maxScaleX) scaleX = maxScaleX;
    if (scaleY > maxScaleY) scaleY = maxScaleY;

    // Minimum scale before going below minSize
    const minScaleX = minSize / (r.width || 1);
    const minScaleY = minSize / (r.height || 1);

    if (scaleX < minScaleX) scaleX = minScaleX;
    if (scaleY < minScaleY) scaleY = minScaleY;
  }

  return { x: scaleX, y: scaleY };
}

/**
 * Scales and repositions `child` so that it transforms from `from` rect to `to` rect.
 * Used per-object during group resize.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) {
    return child;
  }
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;

  // Position relative to from rect's origin
  const relX = child.x - from.x;
  const relY = child.y - from.y;

  return {
    x: to.x + relX * scaleX,
    y: to.y + relY * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}


