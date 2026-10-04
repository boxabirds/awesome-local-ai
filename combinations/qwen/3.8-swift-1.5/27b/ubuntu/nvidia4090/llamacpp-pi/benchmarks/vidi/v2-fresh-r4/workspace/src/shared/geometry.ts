/**
 * Pure geometry helpers for the board. No DOM, no React imports.
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

/**
 * Returns true if `inner` is entirely contained within `outer`
 * (all four edges of inner are inside outer, touching edges counts as inside).
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
 * Returns the union (bounding) rect of all given rects, or null if the list is empty.
 */
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

/**
 * Normalize two points into a rect (handles negative width/height).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Resize a rect from a given handle by a delta (in world units).
 * - Corner handles (nw, ne, sw, se) resize both axes.
 * - Edge handles (n, s, e, w) resize one axis.
 * - The opposite corner/edge is the anchor (stays fixed).
 * - If aspectLocked, the rect maintains its width:height ratio.
 *
 * Returns a new Rect. The rect cannot become smaller than 1x1.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  let { x, y, width, height } = start;

  // Determine which edges move
  const moveLeft = handle.includes('w');
  const moveRight = handle.includes('e');
  const moveTop = handle.includes('n');
  const moveBottom = handle.includes('s');

  let newWidth = width;
  let newHeight = height;
  let newX = x;
  let newY = y;

  if (moveLeft) {
    newX = x + delta.x;
    newWidth = width - delta.x;
  }
  if (moveRight) {
    newWidth = width + delta.x;
  }
  if (moveTop) {
    newY = y + delta.y;
    newHeight = height - delta.y;
  }
  if (moveBottom) {
    newHeight = height + delta.y;
  }

  // Enforce minimum size
  newWidth = Math.max(1, newWidth);
  newHeight = Math.max(1, newHeight);

  // Aspect lock: maintain ratio from the start rect
  if (aspectLocked && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    // Determine the dominant dimension change
    const impliedHeightFromWidth = newWidth / ratio;

    if (impliedHeightFromWidth >= newHeight) {
      // Width is dominant
      newHeight = newWidth / ratio;
    } else {
      // Height is dominant
      newWidth = newHeight * ratio;
    }

    // Re-apply the position based on which edges are moving
    if (moveLeft) {
      newX = x + width - newWidth;
    }
    if (moveTop) {
      newY = y + height - newHeight;
    }
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Clamp a scale factor so that no rect in the list would exceed maxSize
 * or fall below its minSize. Returns a clamped { x, y } scale.
 *
 * For a uniform scale, we find the most restrictive scale across all rects.
 * For non-uniform (per-axis) scaling, we clamp each axis independently.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let scaleX = scale.x;
  let scaleY = scale.y;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i];

    if (r.width > 0) {
      const maxScaleX = maxSize / r.width;
      const minScaleX = minSize / r.width;
      scaleX = Math.min(scaleX, maxScaleX);
      if (scaleX > 0) {
        scaleX = Math.max(scaleX, minScaleX);
      }
    }
    if (r.height > 0) {
      const maxScaleY = maxSize / r.height;
      const minScaleY = minSize / r.height;
      scaleY = Math.min(scaleY, maxScaleY);
      if (scaleY > 0) {
        scaleY = Math.max(scaleY, minScaleY);
      }
    }
  }

  return { x: scaleX, y: scaleY };
}

/**
 * Scale a child rect within a parent rect transformation.
 * Given a `from` rect and a `to` rect, compute where `child` (positioned
 * relative to `from`) should be when the parent becomes `to`.
 *
 * The child is scaled and repositioned proportionally.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) {
    return { x: to.x, y: to.y, width: child.width, height: child.height };
  }

  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;

  const newWidth = child.width * scaleX;
  const newHeight = child.height * scaleY;

  // The child's position relative to the from rect
  const relX = child.x - from.x;
  const relY = child.y - from.y;

  return {
    x: to.x + relX * scaleX,
    y: to.y + relY * scaleY,
    width: newWidth,
    height: newHeight,
  };
}
