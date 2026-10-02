/**
 * Story 7: pure geometry for multi-selection transforms.
 *
 * All values are in world (board) units unless noted. These functions are
 * pure: no Y.Doc, no DOM, no config lookups beyond what callers pass in.
 */

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

/** The eight bounding-box handles. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Guard against degenerate boxes (division in scaleWithin). */
const EPSILON = 1e-6;

/**
 * True when every point of `inner` lies inside (or on the edge of) `outer`.
 * An object merely touching the edge from outside is NOT contained.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Bounding rect of all given rects, or `null` for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned rect spanning the two points (works in any quadrant). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units).
 * Edge handles change one axis, corner handles both. With `aspectLocked`
 * the box keeps its width/height ratio, anchored at the opposite
 * corner/edge; the dominant axis (largest scale) wins.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width = start.width + delta.x;
  if (handle.includes('w')) width = start.width - delta.x;
  if (handle.includes('s')) height = start.height + delta.y;
  if (handle.includes('n')) height = start.height - delta.y;

  if (aspectLocked) {
    // Keep the ratio: one uniform scale, dominant axis wins.
    const sx = width / start.width;
    const sy = height / start.height;
    const s = Math.max(sx, sy, EPSILON);
    width = start.width * s;
    height = start.height * s;
  } else {
    width = Math.max(width, EPSILON);
    height = Math.max(height, EPSILON);
  }

  // Anchor the result at the opposite corner/edge.
  let x = start.x;
  let y = start.y;
  if (handle.includes('w')) x = start.x + start.width - width;
  if (handle.includes('n')) y = start.y + start.height - height;
  return { x, y, width, height };
}

/**
 * Clamp a per-axis scale so that no `rects[i]` scaled by it would fall
 * below `minSizes[i]` or above `maxSize` on either axis. Returns the
 * largest (or smallest) per-axis scale that satisfies every limit, so the
 * whole selection stops as soon as the first object reaches a limit.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let minX = 0;
  let minY = 0;
  let maxX = Infinity;
  let maxY = Infinity;
  for (let i = 0; i < rects.length; i++) {
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
  return {
    x: Math.min(Math.max(scale.x, minX), maxX),
    y: Math.min(Math.max(scale.y, minY), maxY),
  };
}

/**
 * Reposition and scale `child` (which lies inside `from`) so it occupies
 * the same relative position/size inside `to`.
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
