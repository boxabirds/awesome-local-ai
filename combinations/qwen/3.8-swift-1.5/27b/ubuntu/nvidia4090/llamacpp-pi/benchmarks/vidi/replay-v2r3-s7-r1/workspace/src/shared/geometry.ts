/**
 * Story 7: pure world-space geometry for marquee selection and group
 * transforms. All functions are pure (no doc, no DOM).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** True when all four edges of `inner` lie inside (or on) `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest rect containing all given rects, or `null` for an empty list. */
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

/** The axis-aligned rect spanning points `a` and `b`. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resize `start` from `handle` by world-space `delta`. Edge handles change one
 * axis; corners change both. When `aspectLocked`, the width:height ratio is
 * kept, anchored at the opposite edge/corner: while growing, the dominant axis
 * drives the scale (the box reaches the pointer); while shrinking, the
 * dominant shrink drives it (so an inward drag on any axis shrinks the box).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width = start.width + delta.x;
  if (handle.includes('s')) height = start.height + delta.y;
  if (handle.includes('w')) width = start.width - delta.x;
  if (handle.includes('n')) height = start.height - delta.y;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const sx = width / start.width;
    const sy = height / start.height;
    let s: number;
    if (sx >= 1 && sy >= 1) s = Math.max(sx, sy);
    else if (sx <= 1 && sy <= 1) s = Math.min(sx, sy);
    else s = sx; // mixed: the width axis carries the pointer's intent
    width = start.width * s;
    height = start.height * s;
  }

  width = Math.max(0, width);
  height = Math.max(0, height);
  const x = handle.includes('w') ? start.x + start.width - width : start.x;
  const y = handle.includes('n') ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

/**
 * Clamp an anisotropic scale so that no rect in `rects` crosses its
 * `minSizes` entry (per-rect minimum) or `maxSize` (global maximum) on either
 * axis. Returns the single largest (or smallest) scale satisfying all limits:
 * the whole selection stops as soon as the first object reaches a limit.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let minX = 0;
  let maxX = Infinity;
  let minY = 0;
  let maxY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      minX = Math.max(minX, min / r.width);
      maxX = Math.min(maxX, maxSize / r.width);
    }
    if (r.height > 0) {
      minY = Math.max(minY, min / r.height);
      maxY = Math.min(maxY, maxSize / r.height);
    }
  });
  const x = Number.isFinite(scale.x) ? Math.min(Math.max(scale.x, minX), maxX) : 0;
  const y = Number.isFinite(scale.y) ? Math.min(Math.max(scale.y, minY), maxY) : 0;
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/**
 * Scale `child` (position and size) from the `from` box into the `to` box: the
 * child keeps its relative position and proportions inside the box.
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
