/** A rectangle in world coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in world coordinates (re-exported for convenience). */
export interface Point {
  x: number;
  y: number;
}

/** The 8 resize handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * Returns true when `outer` fully encloses `inner` (all four edges of inner lie
 * inside outer). Touching edges counts as inside.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Return the smallest rect that encloses all given rects, or null for empty input.
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (!isFiniteRect(r)) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Given two corners, return a normalised rect (width/height always >= 0).
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
 * Resize `start` by dragging `handle` by `delta` (world-unit offset).
 * When `aspectLocked`, the bounding box keeps its aspect ratio.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isFiniteRect(start) || !isFinitePoint(delta)) return { ...start };

  // Compute new edges
  let nx = start.x, ny = start.y;
  let nr = start.x + start.width, nb = start.y + start.height;

  if (handle.includes('w')) nx += delta.x;
  if (handle.includes('e')) nr += delta.x;
  if (handle === 'n' || handle === 'nw' || handle === 'ne') ny += delta.y;
  if (handle === 's' || handle === 'sw' || handle === 'se') nb += delta.y;

  let nw = nr - nx;
  let nh = nb - ny;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const aspect = start.width / start.height;
    // Use the dominant axis change to preserve ratio
    const dw = nw - start.width;
    const dh = nh - start.height;
    if (Math.abs(dw) >= Math.abs(dh)) {
      nh = nw / aspect;
    } else {
      nw = nh * aspect;
    }
    // Recompute fixed edges based on which handle is being dragged
    if (handle.includes('w')) nx = (start.x + start.width) - nw;
    if (handle === 'n' || handle === 'nw' || handle === 'ne') ny = (start.y + start.height) - nh;
  }

  // Clamp to positive dimensions
  if (nw < 0) nw = 0;
  if (nh < 0) nh = 0;

  return { x: nx, y: ny, width: nw, height: nh };
}

/**
 * Clamp a non-uniform scale so that no rect's side would go below its minSize
 * or above maxSize. Returns the clamped scale as {x, y}.
 * `rects[i]` and `minSizes[i]` correspond to each other.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return { x: 1, y: 1 };
  let sx = scale.x;
  let sy = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minS = minSizes[i] ?? 0;
    // Clamp scale so r.width * sx >= minS and r.width * sx <= maxSize
    if (r.width > 0) {
      if (sx * r.width < minS) sx = minS / r.width;
      if (sx * r.width > maxSize) sx = maxSize / r.width;
      if (sy * r.height < minS) sy = minS / r.height;
      if (sy * r.height > maxSize) sy = maxSize / r.height;
    }
  }

  // Prevent negative or non-finite
  if (!Number.isFinite(sx) || sx <= 0) sx = 0.001;
  if (!Number.isFinite(sy) || sy <= 0) sy = 0.001;

  return { x: sx, y: sy };
}

/**
 * Map `child` rect from being inside `from` to being inside `to`, preserving
 * relative position and size ratios.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return { ...to };
  const rx = to.width / from.width;
  const ry = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * rx,
    y: to.y + (child.y - from.y) * ry,
    width: child.width * rx,
    height: child.height * ry,
  };
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}
