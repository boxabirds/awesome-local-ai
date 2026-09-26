/**
 * Pure geometry helpers for multi-object selection and transform (story 7).
 * Framework-free: imported by the Durable Object worker transitively, so no
 * DOM or React may be referenced here.
 */

/** A rectangle in world units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in world or screen units depending on the call site. */
export interface Point {
  x: number;
  y: number;
}

/** The eight resize handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Human-readable label position for a handle's `aria-label`. */
export const HANDLE_LABEL: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

const EPS = 1e-6;

/** True when `inner` lies entirely inside `outer` (edges touching count). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

/** The smallest rect enclosing all `rects`, or `null` for an empty list. */
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

/** The axis-aligned rectangle spanned by two opposite corners. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units).
 *
 * Edge handles move one axis, corner handles move both. When `aspectLocked`
 * the width:height ratio is preserved using the dominant scale factor, with
 * the opposite corner/edge held fixed as the anchor.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  let newLeft = start.x;
  let newRight = right;
  let newTop = start.y;
  let newBottom = bottom;
  if (hasW) newLeft = start.x + delta.x;
  if (hasE) newRight = right + delta.x;
  if (hasN) newTop = start.y + delta.y;
  if (hasS) newBottom = bottom + delta.y;

  const rawW = newRight - newLeft;
  const rawH = newBottom - newTop;

  let finalW: number;
  let finalH: number;
  if (aspectLocked) {
    const scale = aspectScale(start, rawW, rawH, { hasW, hasE, hasN, hasS });
    finalW = start.width * scale;
    finalH = start.height * scale;
  } else {
    finalW = rawW;
    finalH = rawH;
  }

  // Keep the anchor (the corner/edge opposite the dragged handle) fixed.
  const x = hasW ? newRight - finalW : newLeft;
  const y = hasN ? newBottom - finalH : newTop;
  return { x, y, width: finalW, height: finalH };
}

function aspectScale(
  start: Rect,
  rawW: number,
  rawH: number,
  edges: { hasW: boolean; hasE: boolean; hasN: boolean; hasS: boolean },
): number {
  const moving = edges.hasW || edges.hasE;
  const stretching = edges.hasN || edges.hasS;
  const scaleW = moving && start.width !== 0 ? rawW / start.width : 1;
  const scaleH = stretching && start.height !== 0 ? rawH / start.height : 1;
  // Only the axes actually being dragged contribute; take the dominant one.
  return Math.max(scaleW, scaleH);
}

/**
 * Clamp a bounding-box scale so that no object crosses its per-type minimum
 * (`minSizes[i]`) or `maxSize`, applied independently on each axis. The whole
 * selection stops at the scale where the first object reaches its limit.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let lowX = 0;
  let lowY = 0;
  let highX = Infinity;
  let highY = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i]!;
    const min = minSizes[i] ?? 0;
    if (rect.width > 0) {
      lowX = Math.max(lowX, min / rect.width);
      highX = Math.min(highX, maxSize / rect.width);
    }
    if (rect.height > 0) {
      lowY = Math.max(lowY, min / rect.height);
      highY = Math.min(highY, maxSize / rect.height);
    }
  }
  return {
    x: clamp(scale.x, lowX, highX),
    y: clamp(scale.y, lowY, highY),
  };
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Affinely map `child` from bounding box `from` to bounding box `to`,
 * preserving relative position and proportional size.
 */
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

