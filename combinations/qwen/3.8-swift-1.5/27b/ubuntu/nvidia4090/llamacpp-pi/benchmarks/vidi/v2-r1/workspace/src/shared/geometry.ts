/**
 * Story 7: pure geometry for selection, marquee and group resize.
 * All values are in world units (board coordinates).
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

const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

export function isHandle(value: unknown): value is Handle {
  return typeof value === 'string' && (HANDLES as readonly string[]).includes(value);
}

function finiteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height)
  );
}

/**
 * True only when every edge of `inner` lies strictly inside `outer`.
 * An object that is partly inside, or merely touches the rectangle from
 * outside, is NOT contained (PRD sel.marquee).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finiteRect(outer) || !finiteRect(inner)) return false;
  if (inner.width <= 0 || inner.height <= 0) return false;
  return (
    outer.x < inner.x &&
    outer.y < inner.y &&
    inner.x + inner.width < outer.x + outer.width &&
    inner.y + inner.height < outer.y + outer.height
  );
}

/** Bounding box of all rects; null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!finiteRect(r)) continue;
    if (r.width < 0 || r.height < 0) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned rect spanning two points, with non-negative size. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units).
 *
 * - Edge handles change one axis; corner handles change both.
 * - The opposite corner/edge is the anchor.
 * - With `aspectLocked` the width-to-height ratio of `start` is kept:
 *   - corner handles: a single scale is derived from the pointer (the axis
 *     with the larger change wins) and applied to both axes from the
 *     opposite corner;
 *   - edge handles: the free axis follows the pointer and the fixed axis
 *     scales proportionally, staying centred on its middle.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!finiteRect(start) || start.width <= 0 || start.height <= 0) {
    // Non-finite input: return a sanitised copy of the start rect, no resize.
    return {
      x: Number.isFinite(start.x) ? start.x : 0,
      y: Number.isFinite(start.y) ? start.y : 0,
      width: Number.isFinite(start.width) ? start.width : 0,
      height: Number.isFinite(start.height) ? start.height : 0,
    };
  }
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return start;

  const isWest = handle === 'w' || handle === 'nw' || handle === 'sw';
  const isEast = handle === 'e' || handle === 'ne' || handle === 'se';
  const isNorth = handle === 'n' || handle === 'nw' || handle === 'ne';
  const isSouth = handle === 's' || handle === 'sw' || handle === 'se';
  const hx = isWest || isEast;
  const hy = isNorth || isSouth;

  if (!aspectLocked) {
    let width = start.width;
    let height = start.height;
    if (hx) width = isWest ? start.width - delta.x : start.width + delta.x;
    if (hy) height = isNorth ? start.height - delta.y : start.height + delta.y;
    width = Math.max(0, width);
    height = Math.max(0, height);
    const x = isWest ? start.x + (start.width - width) : start.x;
    const y = isNorth ? start.y + (start.height - height) : start.y;
    return { x, y, width, height };
  }

  // Aspect-locked: derive a scale, then recompute from the anchor.
  let scaleX = 1;
  let scaleY = 1;
  if (hx) {
    const w = isWest ? start.width - delta.x : start.width + delta.x;
    scaleX = Math.max(0, w) / start.width;
  }
  if (hy) {
    const h = isNorth ? start.height - delta.y : start.height + delta.y;
    scaleY = Math.max(0, h) / start.height;
  }
  // Corner: pick the axis with the larger magnitude change.
  // Edge: only one axis is involved (the other is 1).
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
  const width = start.width * scale;
  const height = start.height * scale;

  let x = start.x;
  let y = start.y;
  if (handle === 'w' || handle === 'nw' || handle === 'sw') x = start.x + start.width - width;
  if (handle === 'n' || handle === 'ne' || handle === 'nw') y = start.y + start.height - height;
  // Aspect-locked edge handles stay centred on the fixed axis.
  if (handle === 'e' || handle === 'w') y = start.y + (start.height - height) / 2;
  if (handle === 'n' || handle === 's') x = start.x + (start.width - width) / 2;
  return { x, y, width, height };
}

/**
 * Clamp a proposed (non-uniform) scale so that no rect scaled by it falls
 * below its `minSizes` entry or above `maxSize`. Returns the single largest
 * (or smallest) scale at which no object crosses either limit.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y)) return { x: 1, y: 1 };
  if (rects.length === 0) return { x: Math.max(0, scale.x), y: Math.max(0, scale.y) };

  let lowerX = 0;
  let upperX = Infinity;
  let lowerY = 0;
  let upperY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i];
    if (!finiteRect(r)) continue;
    if (r.width > 0) {
      if (Number.isFinite(min) && min > 0) lowerX = Math.max(lowerX, min / r.width);
      if (Number.isFinite(maxSize) && maxSize > 0) upperX = Math.min(upperX, maxSize / r.width);
    }
    if (r.height > 0) {
      if (Number.isFinite(min) && min > 0) lowerY = Math.max(lowerY, min / r.height);
      if (Number.isFinite(maxSize) && maxSize > 0) upperY = Math.min(upperY, maxSize / r.height);
    }
  }

  return {
    x: Math.min(Math.max(scale.x, lowerX), upperX),
    y: Math.min(Math.max(scale.y, lowerY), upperY),
  };
}

/**
 * Map `child` (expressed inside bounding box `from`) into bounding box `to`,
 * scaling size and position proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
