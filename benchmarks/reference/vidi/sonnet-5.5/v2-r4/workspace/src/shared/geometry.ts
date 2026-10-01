export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Smallest scale resizeRect produces; real size limits are applied by clampScale. */
const MIN_SCALE = 0.001;
const UNIFORM_EPSILON = 1e-9;

/** True only when all four edges of `inner` lie inside (or on) `outer`. */
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
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** The rect `start` scaled by (sx, sy) about the edge/corner opposite `handle` (the centre on an unaffected axis). */
export function rectFromScale(start: Rect, sx: number, sy: number, handle: Handle): Rect {
  const width = start.width * sx;
  const height = start.height * sy;
  const x = handle.includes('w') ? start.x + start.width - width : handle.includes('e') ? start.x : start.x + (start.width - width) / 2;
  const y = handle.includes('n') ? start.y + start.height - height : handle.includes('s') ? start.y : start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

/** Resizes `start` by dragging `handle` by `delta` (world units). Edge handles change one axis; corners both. */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const horizontal = handle.includes('e') || handle.includes('w');
  const vertical = handle.includes('n') || handle.includes('s');
  const axis = (active: boolean, size: number, d: number, positive: boolean) => {
    if (!active || !(size > 0)) return 1;
    return Math.max(MIN_SCALE, (size + (positive ? d : -d)) / size);
  };
  let sx = axis(horizontal, start.width, delta.x, handle.includes('e'));
  let sy = axis(vertical, start.height, delta.y, handle.includes('s'));
  if (aspectLocked) {
    if (horizontal && vertical) sx = sy = Math.max(sx, sy);
    else if (horizontal) sy = sx;
    else sx = sy;
  }
  return rectFromScale(start, sx, sy, handle);
}

/**
 * Limits a bounding-box scale so no rect drops below its minimum size or exceeds `maxSize`.
 * A uniform scale stays uniform, so the whole selection stops when the first object reaches a limit.
 * A rect already outside a limit is never forced back inside it.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  const limits = (dim: 'width' | 'height') => {
    let lo = 0;
    let hi = Infinity;
    rects.forEach((r, i) => {
      const size = r[dim];
      if (!(size > 0)) return;
      lo = Math.max(lo, Math.min((minSizes[i] ?? 0) / size, 1));
      hi = Math.min(hi, Math.max(maxSize / size, 1));
    });
    return { lo, hi };
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const lx = limits('width');
  const ly = limits('height');
  if (Math.abs(scale.x - scale.y) <= UNIFORM_EPSILON * Math.max(1, Math.abs(scale.x))) {
    const u = clamp(scale.x, Math.max(lx.lo, ly.lo), Math.min(lx.hi, ly.hi));
    return { x: u, y: u };
  }
  return { x: clamp(scale.x, lx.lo, lx.hi), y: clamp(scale.y, ly.lo, ly.hi) };
}

/** Maps `child` (positioned inside `from`) to the same relative place and proportion inside `to`. */
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
