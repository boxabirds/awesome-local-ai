export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const HALF = 2;
const RATIO_EPSILON = 1e-9;

/** True only when all four edges of `inner` lie within `outer` (touching the edge counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
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

/** The edge a handle moves on each axis: -1 = low edge, 1 = high edge, 0 = this axis is untouched. */
function handleAxes(handle: Handle): { h: -1 | 0 | 1; v: -1 | 0 | 1 } {
  return {
    h: handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0,
    v: handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0,
  };
}

/** Scales `start` by `scale` keeping the edge/corner opposite to `handle` fixed (centred on an untouched axis). */
export function scaleFromHandle(start: Rect, handle: Handle, scale: Point): Rect {
  const { h, v } = handleAxes(handle);
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  const x = h === 1 ? start.x : h === -1 ? start.x + start.width - width : start.x + (start.width - width) / HALF;
  const y = v === 1 ? start.y : v === -1 ? start.y + start.height - height : start.y + (start.height - height) / HALF;
  return { x, y, width, height };
}

/**
 * Rect after dragging `handle` by `delta` (world units) from the opposite corner or edge. With `aspectLocked`
 * the ratio is kept: the axis that grew proportionally more decides the scale.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const { h, v } = handleAxes(handle);
  if (!aspectLocked) {
    // Edge arithmetic keeps whole numbers exact (no scale round trip).
    const x = h === -1 ? start.x + delta.x : start.x;
    const y = v === -1 ? start.y + delta.y : start.y;
    return {
      x,
      y,
      width: h === 0 ? start.width : start.width + h * delta.x,
      height: v === 0 ? start.height : start.height + v * delta.y,
    };
  }
  let sx = start.width > 0 && h !== 0 ? (start.width + h * delta.x) / start.width : 1;
  let sy = start.height > 0 && v !== 0 ? (start.height + v * delta.y) / start.height : 1;
  if (aspectLocked) {
    const s = h === 0 ? sy : v === 0 ? sx : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    sx = s;
    sy = s;
  }
  return scaleFromHandle(start, handle, { x: sx, y: sy });
}

/**
 * Clamps the selection's scale so that no rect gets smaller than its minimum size or larger than `maxSize`.
 * One scale applies to the whole selection; equal x and y scales (aspect locked) stay equal.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  const bounds = (dim: 'width' | 'height') => {
    let lo = 0;
    let hi = Infinity;
    rects.forEach((r, i) => {
      if (!(r[dim] > 0)) return;
      lo = Math.max(lo, (minSizes[i] ?? 0) / r[dim]);
      hi = Math.min(hi, maxSize / r[dim]);
    });
    return { lo, hi };
  };
  const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
  const bx = bounds('width');
  const by = bounds('height');
  if (Math.abs(scale.x - scale.y) <= RATIO_EPSILON) {
    const s = clamp(scale.x, Math.max(bx.lo, by.lo), Math.min(bx.hi, by.hi));
    return { x: s, y: s };
  }
  return { x: clamp(scale.x, bx.lo, bx.hi), y: clamp(scale.y, by.lo, by.hi) };
}

/** Maps `child` from the coordinate frame of `from` to that of `to` (position and size scale proportionally). */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
