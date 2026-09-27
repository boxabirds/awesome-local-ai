// Pure geometry for group selection and transforms (see spec: sel.geometry_ops).
//
// All values are board (world) units. No DOM, no React, no Yjs.

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
/** The eight handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** True when the point lies inside the rect (boundary included). */
export function pointInRect(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.width && p.y <= rect.y + rect.height;
}

/** True when `inner` lies entirely inside `outer` (touching the edge is enough). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Union (smallest enclosing) of the given rects; null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) {
      continue;
    }
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned rect spanning two points (negative deltas normalised away). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Resize `start` by dragging `handle` by a world-unit `delta`.
 * Edge handles change one axis; corner handles change both. With
 * `aspectLocked`, the box keeps its width-to-height ratio: the uniform scale
 * is the larger of the two axes' scales (the pointer wins the axis it moved
 * most). Sizes are clamped to stay positive.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;
  switch (handle) {
    case 'e':
      width = start.width + delta.x;
      break;
    case 'w':
      x = start.x + delta.x;
      width = start.width - delta.x;
      break;
    case 'n':
      y = start.y + delta.y;
      height = start.height - delta.y;
      break;
    case 's':
      height = start.height + delta.y;
      break;
    case 'ne':
      y = start.y + delta.y;
      height = start.height - delta.y;
      width = start.width + delta.x;
      break;
    case 'nw':
      x = start.x + delta.x;
      width = start.width - delta.x;
      y = start.y + delta.y;
      height = start.height - delta.y;
      break;
    case 'se':
      width = start.width + delta.x;
      height = start.height + delta.y;
      break;
    case 'sw':
      x = start.x + delta.x;
      width = start.width - delta.x;
      height = start.height + delta.y;
      break;
  }
  if (aspectLocked && start.width > 0 && start.height > 0) {
    const sx = width / start.width;
    const sy = height / start.height;
    const s = Math.max(Math.abs(sx), Math.abs(sy));
    width = start.width * s;
    height = start.height * s;
    if (handle === 'w' || handle === 'nw' || handle === 'sw') x = start.x + start.width - width;
    if (handle === 'n' || handle === 'ne' || handle === 'nw') y = start.y + start.height - height;
  }
  width = Math.max(width, 1e-6);
  height = Math.max(height, 1e-6);
  return { x, y, width, height };
}

/**
 * Clamp a two-axis scale so that scaling every rect `i` keeps it within
 * [minSizes[i], maxSize] on both axes. Returns one uniform clamped scale for
 * the whole selection so every object stops at the same moment.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y)) return { x: 1, y: 1 };
  let minX = 0;
  let minY = 0;
  let maxX = Infinity;
  let maxY = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
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
  const sx = Math.min(Math.max(scale.x, minX), maxX);
  const sy = Math.min(Math.max(scale.y, minY), maxY);
  return { x: Number.isFinite(sx) ? sx : 1, y: Number.isFinite(sy) ? sy : 1 };
}

/**
 * Re-express `child` (sibling of `from`'s children) in the space that `to`
 * describes: position and size scale proportionally from `from` to `to`.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width <= 0 || from.height <= 0) return child;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (![sx, sy, to.x, to.y].every(Number.isFinite)) return child;
  return {
    x: from.x + (child.x - from.x) * sx,
    y: from.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
