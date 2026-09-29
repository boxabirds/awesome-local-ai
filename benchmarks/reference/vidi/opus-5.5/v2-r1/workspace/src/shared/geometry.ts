// Pure rectangle maths for selection, marquee and resizing. World units throughout.

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

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

/** True when every edge of `inner` lies inside `outer` (edges may coincide). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest rect containing all `rects`; null for none. */
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

/** The rect spanned by two corner points, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * `start` scaled by (sx, sy) around the side or corner opposite `handle`. An axis the handle does
 * not move (n/s for x, e/w for y) scales around the rect's centre.
 */
export function scaleFromHandle(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  const x = handle.includes('e')
    ? start.x
    : handle.includes('w')
      ? start.x + start.width - width
      : start.x + (start.width - width) / 2;
  const y = handle.includes('s')
    ? start.y
    : handle.includes('n')
      ? start.y + start.height - height
      : start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

function ratio(next: number, prev: number): number {
  return prev === 0 ? 1 : next / prev;
}

/** The (sx, sy) that dragging `handle` by `delta` asks for, before any limits. */
export function handleScale(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Point {
  const dw = handle.includes('e') ? delta.x : handle.includes('w') ? -delta.x : 0;
  const dh = handle.includes('s') ? delta.y : handle.includes('n') ? -delta.y : 0;
  let sx = handle.includes('e') || handle.includes('w') ? ratio(start.width + dw, start.width) : 1;
  let sy = handle.includes('n') || handle.includes('s') ? ratio(start.height + dh, start.height) : 1;
  if (aspectLocked) {
    const horizontal = handle === 'e' || handle === 'w';
    const vertical = handle === 'n' || handle === 's';
    // Corners follow whichever axis the pointer moved further (relative to the box).
    const s = horizontal ? sx : vertical ? sy : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    sx = s;
    sy = s;
  }
  return { x: sx, y: sy };
}

/**
 * Resizes `start` by dragging `handle` by `delta`: the opposite side or corner stays put; edge
 * handles change one dimension (both, around the centre, when aspect-locked).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  return scaleFromHandle(start, handle, handleScale(start, handle, delta, aspectLocked));
}

/**
 * Clamps a scale so that no rect gets smaller than its min size or larger than `maxSize` on
 * either axis. One scale for all rects: the whole selection stops as soon as the first object
 * reaches a limit. A uniform scale (x === y, the default when they are equal) stays uniform.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
  uniform: boolean = scale.x === scale.y,
): Point {
  let loX = 0;
  let hiX = Infinity;
  let loY = 0;
  let hiY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      loX = Math.max(loX, min / r.width);
      hiX = Math.min(hiX, maxSize / r.width);
    }
    if (r.height > 0) {
      loY = Math.max(loY, min / r.height);
      hiY = Math.min(hiY, maxSize / r.height);
    }
  });
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  if (uniform) {
    const s = clamp(scale.x, Math.max(loX, loY), Math.min(hiX, hiY));
    return { x: s, y: s };
  }
  return { x: clamp(scale.x, loX, hiX), y: clamp(scale.y, loY, hiY) };
}

/** `child` (inside `from`) mapped into `to`, keeping its relative position and size. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = ratio(to.width, from.width);
  const sy = ratio(to.height, from.height);
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
