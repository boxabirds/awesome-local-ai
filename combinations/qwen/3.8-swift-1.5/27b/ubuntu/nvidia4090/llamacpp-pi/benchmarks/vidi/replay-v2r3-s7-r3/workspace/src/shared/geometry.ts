/**
 * Pure world-unit geometry for multi-selection (story 7): marquee
 * containment, bounding boxes, handle resizing and uniform group scaling.
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

/** The eight resize handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True only when every edge of `inner` lies strictly inside `outer`.
 * An object that is only partly inside, or merely touches the rectangle's
 * edge from outside, is NOT contained (PRD sel.marquee).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x > outer.x &&
    inner.y > outer.y &&
    inner.x + inner.width < outer.x + outer.width &&
    inner.y + inner.height < outer.y + outer.height
  );
}

/**
 * The smallest rect containing all given rects, or `null` when the list is
 * empty (or contains no finite rect).
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      continue;
    }
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rect spanning two corner points (normalised so width/height are >= 0). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function affectsWidth(h: Handle): boolean {
  return h === 'e' || h === 'w' || h === 'ne' || h === 'nw' || h === 'se' || h === 'sw';
}

function affectsHeight(h: Handle): boolean {
  return h === 'n' || h === 's' || h === 'ne' || h === 'nw' || h === 'se' || h === 'sw';
}

/** True when the handle moves the left edge (the right edge is the anchor). */
function movesLeft(h: Handle): boolean {
  return h === 'w' || h === 'nw' || h === 'sw';
}

/** True when the handle moves the top edge (the bottom edge is the anchor). */
function movesTop(h: Handle): boolean {
  return h === 'n' || h === 'ne' || h === 'nw';
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units). Edge handles
 * change one axis, corner handles both. When `aspectLocked`, the
 * width-to-height ratio of `start` is kept: corner handles are driven by the
 * width, edge handles by their own axis; the rect stays anchored on the
 * opposite edge/corner.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let width = start.width;
  let height = start.height;
  if (affectsWidth(handle)) width = start.width + (movesLeft(handle) ? -delta.x : delta.x);
  if (affectsHeight(handle)) height = start.height + (movesTop(handle) ? -delta.y : delta.y);

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const ratio = start.height / start.width;
    if (affectsHeight(handle) && !affectsWidth(handle)) {
      // 'n' / 's': the height drives, the width follows the ratio.
      width = height / ratio;
    } else {
      // 'e' / 'w' and all corners: the width drives, the height follows.
      height = width * ratio;
    }
  }

  return {
    x: movesLeft(handle) ? start.x + start.width - width : start.x,
    y: movesTop(handle) ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

function clampValue(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Clamp a scale so that no `rects[i]` scaled by it falls below
 * `minSizes[i]` on either axis or above `maxSize`. Returns the largest (when
 * scaling up) or smallest (when scaling down) scale inside those bounds.
 * A uniform request (`scale.x === scale.y`) is clamped to a single uniform
 * factor, so the whole selection stops at the first object's limit
 * (PRD sel.size_limits, design key decision 2).
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let minX = 0;
  let maxX = Infinity;
  let minY = 0;
  let maxY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = i < minSizes.length ? minSizes[i] : 0;
    if (r.width > 0) {
      minX = Math.max(minX, min / r.width);
      maxX = Math.min(maxX, maxSize / r.width);
    }
    if (r.height > 0) {
      minY = Math.max(minY, min / r.height);
      maxY = Math.min(maxY, maxSize / r.height);
    }
  }
  if (scale.x === scale.y) {
    const s = clampValue(scale.x, Math.max(minX, minY), Math.min(maxX, maxY));
    return { x: s, y: s };
  }
  return { x: clampValue(scale.x, minX, maxX), y: clampValue(scale.y, minY, maxY) };
}

/**
 * Affinely map `child` from the `from` rect into the `to` rect: points keep
 * their relative position inside `from`, sizes scale by the ratio of the two
 * rects. Used to scale each selected object with its selection's bounding box.
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
