export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const MIN_SCALE = 1e-6;
const UNIFORM_EPSILON = 1e-9;
const HALF = 2;

/** True when every edge of `inner` lies inside (or on) `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

const affectsX = (h: Handle) => h.includes('e') || h.includes('w');
const affectsY = (h: Handle) => h.includes('n') || h.includes('s');

/** Scale factors on each axis produced by dragging `handle` of `start` by `delta` (never zero or negative). */
export function handleScale(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Point {
  const dx = handle.includes('e') ? delta.x : handle.includes('w') ? -delta.x : 0;
  const dy = handle.includes('s') ? delta.y : handle.includes('n') ? -delta.y : 0;
  let sx = affectsX(handle) ? Math.max(MIN_SCALE, (start.width + dx) / start.width) : 1;
  let sy = affectsY(handle) ? Math.max(MIN_SCALE, (start.height + dy) / start.height) : 1;
  if (aspectLocked) {
    const s = !affectsY(handle) ? sx : !affectsX(handle) ? sy : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    sx = s; sy = s;
  }
  return { x: sx, y: sy };
}

/** `start` scaled by `scale`, keeping the edge/corner opposite `handle` fixed (centred on an unaffected axis). */
export function scaleRectFrom(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  const x = handle.includes('w') ? start.x + start.width - width
    : handle.includes('e') ? start.x
      : start.x + (start.width - width) / HALF;
  const y = handle.includes('n') ? start.y + start.height - height
    : handle.includes('s') ? start.y
      : start.y + (start.height - height) / HALF;
  return { x, y, width, height };
}

export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  return scaleRectFrom(start, handle, handleScale(start, handle, delta, aspectLocked));
}

/**
 * Clamps one selection-wide scale so that no rect gets smaller than its min size or larger than maxSize.
 * Rects already outside a limit never force a change in the direction that does not make them worse.
 * Equal x and y scales (aspect-locked resize) are clamped together so the ratio survives.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  const bounds = (size: (r: Rect) => number) => {
    let lo = MIN_SCALE; let hi = Infinity;
    rects.forEach((r, i) => {
      const s = size(r);
      if (s <= 0) return;
      lo = Math.max(lo, Math.min(1, (minSizes[i] ?? 0) / s));
      hi = Math.min(hi, Math.max(1, maxSize / s));
    });
    return { lo, hi };
  };
  const bx = bounds((r) => r.width);
  const by = bounds((r) => r.height);
  const clamp = (v: number, b: { lo: number; hi: number }) => Math.min(b.hi, Math.max(b.lo, v));
  if (Math.abs(scale.x - scale.y) < UNIFORM_EPSILON) {
    const s = clamp(clamp(scale.x, bx), by);
    return { x: s, y: s };
  }
  return { x: clamp(scale.x, bx), y: clamp(scale.y, by) };
}

/** Maps `child` from the frame `from` into the frame `to` (position and size scale proportionally). */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
