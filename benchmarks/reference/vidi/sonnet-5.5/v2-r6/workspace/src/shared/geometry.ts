export interface Point { readonly x: number; readonly y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Smallest extent resizeRect returns, so a drag past the opposite edge never flips or collapses the box. */
const MIN_EXTENT = 1;
const EQUAL_SCALE_EPSILON = 1e-9;
const HALF = 2;

/** True only when all four edges of `inner` lie inside (or on) `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function unionRects(rects: Rect[]): Rect | null {
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

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** `start` scaled by `scale`, keeping the edge or corner opposite `handle` in place. */
export function scaledRect(start: Rect, handle: Handle, scale: Point): Rect {
  return placeRect(start, handle, start.width * scale.x, start.height * scale.y);
}

function placeRect(start: Rect, handle: Handle, width: number, height: number): Rect {
  const x = handle.includes('w') ? start.x + start.width - width
    : handle.includes('e') ? start.x : start.x + (start.width - width) / HALF;
  const y = handle.includes('n') ? start.y + start.height - height
    : handle.includes('s') ? start.y : start.y + (start.height - height) / HALF;
  return { x, y, width, height };
}

/**
 * The box after dragging `handle` by `delta`, anchored at the opposite corner or edge. Edge handles
 * change one axis; with `aspectLocked` the other axis follows (centred) so the ratio is unchanged.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width += delta.x;
  if (handle.includes('w')) width -= delta.x;
  if (handle.includes('s')) height += delta.y;
  if (handle.includes('n')) height -= delta.y;
  width = Math.max(MIN_EXTENT, width);
  height = Math.max(MIN_EXTENT, height);
  if (aspectLocked) {
    const sx = width / start.width;
    const sy = height / start.height;
    const horizontal = handle === 'e' || handle === 'w';
    const vertical = handle === 'n' || handle === 's';
    const s = horizontal ? sx : vertical ? sy : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    return scaledRect(start, handle, { x: s, y: s });
  }
  return placeRect(start, handle, width, height);
}

/**
 * Clamps a bounding-box scale so no object ends smaller than its minimum or larger than `maxSize`.
 * When both axes scale equally (aspect locked) one common scale is returned, so the whole selection
 * stops as soon as the first object reaches a limit.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let loX = 0;
  let loY = 0;
  let hiX = Infinity;
  let hiY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    loX = Math.max(loX, min / r.width);
    loY = Math.max(loY, min / r.height);
    hiX = Math.min(hiX, maxSize / r.width);
    hiY = Math.min(hiY, maxSize / r.height);
  });
  const clamp = (s: number, lo: number, hi: number) => Math.max(lo, Math.min(s, hi));
  if (Math.abs(scale.x - scale.y) <= EQUAL_SCALE_EPSILON * Math.max(1, Math.abs(scale.x))) {
    const s = clamp(scale.x, Math.max(loX, loY), Math.min(hiX, hiY));
    return { x: s, y: s };
  }
  return { x: clamp(scale.x, loX, hiX), y: clamp(scale.y, loY, hiY) };
}

/** Maps `child` from its place inside box `from` to the same relative place inside box `to`. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) return { ...child };
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
