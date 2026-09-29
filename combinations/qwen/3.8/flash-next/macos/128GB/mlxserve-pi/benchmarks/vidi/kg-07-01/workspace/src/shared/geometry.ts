// Pure rectangle and scaling maths for selection and transforms. No DOM, no Yjs.

/** An axis-aligned rectangle in world coordinates. */
export interface Rect { x: number; y: number; width: number; height: number }

/** Point / offset in world units. */
export interface Point { x: number; y: number }

/** 8 resize handles: corners and edge midpoints. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

function finite(...v: number[]): boolean {
  return v.every((n) => Number.isFinite(n));
}

/** True when `inner` lies entirely inside `outer` (touching edges count as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Bounding box of a set of rects, or null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Normalize a drag start and end point into a non-negative rect. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Returns the anchor point (the point that stays fixed) for the opposite handle. */
function anchorPoint(r: Rect, h: Handle): Point {
  switch (h) {
    case 'se': return { x: r.x, y: r.y };
    case 'nw': return { x: r.x + r.width, y: r.y + r.height };
    case 'ne': return { x: r.x, y: r.y + r.height };
    case 'sw': return { x: r.x + r.width, y: r.y };
    case 'n': return { x: r.x, y: r.y + r.height };
    case 's': return { x: r.x, y: r.y };
    case 'e': return { x: r.x, y: r.y };
    case 'w': return { x: r.x + r.width, y: r.y };
  }
}

/**
 * Resize a starting rect by moving one handle by a (world-unit) delta.
 * When `aspectLocked` is true the bounding box keeps its width:height ratio.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!finite(start.x, start.y, start.width, start.height, delta.x, delta.y)) return { ...start };

  let newW = start.width;
  let newH = start.height;

  if (handle.includes('e')) newW += delta.x;
  if (handle.includes('w')) newW -= delta.x;
  if (handle.includes('s')) newH += delta.y;
  if (handle.includes('n')) newH -= delta.y;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (handle === 'n' || handle === 's') {
      newW = newH * ratio;
    } else if (handle === 'e' || handle === 'w') {
      newH = newW / ratio;
    } else {
      // Corner: use the dominant axis (larger absolute relative change) to keep ratio.
      const sw = (start.width + (handle.includes('e') ? delta.x : -delta.x)) / start.width;
      const sh = (start.height + (handle.includes('s') ? delta.y : -delta.y)) / start.height;
      const s = Math.abs(sw - 1) >= Math.abs(sh - 1) ? sw : sh;
      newW = start.width * s;
      newH = start.height * s;
    }
  }

  if (newW < 0) newW = 0;
  if (newH < 0) newH = 0;

  const anchor = anchorPoint(start, handle);
  let x: number, y: number;
  if (handle.includes('w')) x = anchor.x - newW;
  else x = anchor.x;
  if (handle.includes('n')) y = anchor.y - newH;
  else y = anchor.y;

  return { x, y, width: newW, height: newH };
}

/**
 * Clamp a proposed uniform scale factor so no child rect crosses its minimum or the maximum size.
 * Returns a clamped uniform scale as { x, y } (both axes the same value).
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (!finite(scale.x, scale.y) || rects.length === 0) return { x: 1, y: 1 };

  let sx = scale.x;
  let sy = scale.y;

  // Clamp sx
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      if (min > 0 && sx * r.width < min) sx = min / r.width;
      if (maxSize > 0 && sx * r.width > maxSize) sx = maxSize / r.width;
    }
    if (r.height > 0) {
      if (min > 0 && sy * r.height < min) sy = min / r.height;
      if (maxSize > 0 && sy * r.height > maxSize) sy = maxSize / r.height;
    }
  }

  // For uniform (aspect-locked) scaling, use the tighter constraint.
  if (Math.abs(scale.x - scale.y) < 1e-9) {
    // Both axes were the same going in; use the more restrictive result.
    const growing = scale.x >= 1;
    const s = growing ? Math.min(sx, sy) : Math.max(sx, sy);
    return { x: s, y: s };
  }

  return { x: sx, y: sy };
}

/** Scale `child` from its original parent rect (`from`) to a new parent rect (`to`), keeping relative position. */
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
