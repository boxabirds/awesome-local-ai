// Pure geometry helpers for multi-selection transforms.
// Framework-free: no React, no DOM, no Yjs.

/** Axis-aligned rectangle in world coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen-space point (also used for world points). */
export interface Point {
  x: number;
  y: number;
}

/**
 * A width and a height, in whatever units the code around it is in. It is a size
 * rather than a place, which is why it is not a {@link Rect} with the place left
 * out of it.
 */
export interface Size {
  width: number;
  height: number;
}

/** The 8 resize handles around a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when `inner` lies fully inside `outer` (all four edges are at or within
 * the outer rect's boundaries).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rect containing all `rects`, or null if the array is empty.
 */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxR) maxR = r.x + r.width;
    if (r.y + r.height > maxB) maxB = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxR - minX, height: maxB - minY };
}

/**
 * Normalize two diagonal points into a Rect (the min corner is x,y).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Compute a new Rect after dragging a handle by `delta` screen-space world offset.
 * Edge handles change one axis; corner handles change both.
 * When `aspectLocked` is true, the ratio (width/height) is preserved from the
 * original rect, anchored from the opposite corner/edge.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  // Determine which edges move
  const moveLeft = handle === 'w' || handle === 'nw' || handle === 'sw';
  const moveRight = handle === 'e' || handle === 'ne' || handle === 'se';
  const moveTop = handle === 'n' || handle === 'nw' || handle === 'ne';
  const moveBottom = handle === 's' || handle === 'sw' || handle === 'se';

  if (moveLeft) {
    const newWidth = width - delta.x;
    x = x + delta.x;
    width = newWidth;
  }
  if (moveRight) {
    width = width + delta.x;
  }
  if (moveTop) {
    const newHeight = height - delta.y;
    y = y + delta.y;
    height = newHeight;
  }
  if (moveBottom) {
    height = height + delta.y;
  }

  if (aspectLocked) {
    const ratio = start.width / start.height;
    if (Number.isFinite(ratio) && ratio > 0) {
      // Determine which axis moved to drive the other
      const horizMoved = moveLeft || moveRight;
      const vertMoved = moveTop || moveBottom;

      if (horizMoved && vertMoved) {
        // Corner: use the larger relative change
        const scaleX = width / start.width;
        const scaleY = height / start.height;
        if (Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)) {
          height = width / ratio;
          // Adjust y for top-moving handles
          if (moveTop) {
            y = start.y + start.height - height;
          }
        } else {
          width = height * ratio;
          if (moveLeft) {
            x = start.x + start.width - width;
          }
        }
      } else if (horizMoved) {
        const newHeight = width / ratio;
        if (moveTop) {
          y = start.y + start.height - newHeight;
        }
        height = newHeight;
      } else if (vertMoved) {
        const newWidth = height * ratio;
        if (moveLeft) {
          x = start.x + start.width - newWidth;
        }
        width = newWidth;
      }
    }
  }

  return { x, y, width, height };
}

/**
 * Given a proposed scale factor (scaleX, scaleY), a set of current rects,
 * their per-type minSizes, and a global maxSize, return the largest uniform
 * scale that does not cause any object to go below its minSize or above maxSize.
 *
 * Returns a Point { x: scaleX, y: scaleY } where both are the same value
 * (uniform scaling) clamped as needed.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return { x: scale.x, y: scale.y };

  // One scale is applied to both axes, so one number has to keep every object's
  // width *and* height inside [minSize, maxSize]. Each object therefore
  // contributes a floor — the smallest scale that leaves both its sides at or
  // above its minimum — and a ceiling, the largest that leaves both at or below
  // the maximum. The scale that satisfies everybody is the proposal pulled into
  // the overlap of all those intervals: the largest floor and the smallest
  // ceiling.
  //
  // The floor is the largest rather than the smallest because a scale below it
  // puts somebody's box under its minimum. An aspect-locked object whose height
  // is its short side is bounded by its height: taking the smaller floor would
  // stop its width at the minimum and carry its height quietly underneath it,
  // which is a minimum that was not kept.
  let floor = 0;
  let ceiling = Infinity;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;
    if (minSize > 0 && r.width > 0 && r.height > 0) {
      floor = Math.max(floor, minSize / r.width, minSize / r.height);
    }
    if (r.width > 0 && r.height > 0) {
      ceiling = Math.min(ceiling, maxSize / r.width, maxSize / r.height);
    }
  }

  // A proposal which asked for two different scales is one scale already, in the
  // sense that a resize cannot have both: the more modest of the two is what is
  // applied, and it is then pulled into the interval above.
  const proposed = Math.min(scale.x, scale.y);
  const applied = Math.min(Math.max(proposed, floor), ceiling);

  return { x: applied, y: applied };
}

/**
 * Scale a child rect within a bounding box. The child's position and size are
 * remapped from the `from` bounding rect to the `to` bounding rect.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
