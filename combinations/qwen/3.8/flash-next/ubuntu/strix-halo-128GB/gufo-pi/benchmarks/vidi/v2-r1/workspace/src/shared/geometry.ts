/**
 * Pure geometry for selection bounding boxes, marquee containment, group
 * resize and scale clamping. No DOM, no React.
 */

import type { Point } from './board-model';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when `inner` lies entirely inside `outer`. An object touching the edge
 * from outside is NOT contained.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Bounding box of several rects, or null for an empty array. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Normalize two screen (or world) points into a rect with positive dimensions. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize a bounding box by dragging a handle. `delta` is the pointer movement
 * in world units. `aspectLocked` keeps the width-to-height ratio unchanged.
 *
 * The anchor (opposite corner/edge) stays fixed.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let { x, y, width, height } = start;

  // Determine which edges move
  const moveLeft = handle.includes('w');
  const moveRight = handle.includes('e');
  const moveTop = handle.includes('n');
  const moveBottom = handle.includes('s');

  if (moveLeft) {
    x += delta.x;
    width -= delta.x;
  }
  if (moveRight) {
    width += delta.x;
  }
  if (moveTop) {
    y += delta.y;
    height -= delta.y;
  }
  if (moveBottom) {
    height += delta.y;
  }

  // For edge-only handles (n, s, e, w), only one axis changes.
  const isCorner = handle.length === 2;
  const isHorizontalEdge = handle === 'e' || handle === 'w';
  const isVerticalEdge = handle === 'n' || handle === 's';

  if (aspectLocked && isCorner) {
    // Maintain the original aspect ratio
    const origRatio = start.width / start.height;
    // Determine which dimension to trust based on the larger delta
    if (Math.abs(delta.x) >= Math.abs(delta.y)) {
      height = width / origRatio;
      // Adjust y if top edge moved
      if (moveTop) {
        y = start.y + start.height - height;
      }
    } else {
      width = height * origRatio;
      // Adjust x if left edge moved
      if (moveLeft) {
        x = start.x + start.width - width;
      }
    }
  } else if (aspectLocked && isHorizontalEdge) {
    // e or w edge with aspect lock: height changes proportionally
    const origRatio = start.width / start.height;
    height = width / origRatio;
    // Keep vertical center fixed
    const centerY = start.y + start.height / 2;
    y = centerY - height / 2;
  } else if (aspectLocked && isVerticalEdge) {
    // n or s edge with aspect lock: width changes proportionally
    const origRatio = start.width / start.height;
    width = height * origRatio;
    // Keep horizontal center fixed
    const centerX = start.x + start.width / 2;
    x = centerX - width / 2;
  }

  // Ensure positive dimensions (can happen with large drags)
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }

  return { x, y, width, height };
}

/**
 * Given a desired scale (dx, dy as ratios) applied to a bounding box, clamp so
 * that no object crosses its type's minSize or maxSize. Returns the single
 * uniform scale (sx, sy) that keeps all objects within limits.
 *
 * `rects` are the individual object rects.
 * `minSizes[i]` corresponds to `rects[i]`.
 * `maxSize` is the global maximum.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return scale;

  let sx = scale.x;
  let sy = scale.y;

  // Find the union bounding box for relative scaling
  const bound = unionRects(rects);
  if (!bound || bound.width === 0 || bound.height === 0) return scale;

  // Compute the overall scale we'd apply to each object
  // Each object's new size = object.width * (bound.width * sx) / bound.width = object.width * sx
  // Wait no - scale is defined relative to the bounding box, so:
  // new_box_width = bound.width * sx, new_box_height = bound.height * sy
  // Each object: new_width = obj.width * sx, new_height = obj.height * sy
  // (scaleWithin preserves relative position within the box)

  let maxScaleX = Infinity;
  let maxScaleY = Infinity;
  let minScaleX = 0;
  let minScaleY = 0;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;

    // Minimum constraint: r.width * sx >= minSize => sx >= minSize / r.width
    if (r.width > 0) {
      minScaleX = Math.max(minScaleX, minSize / r.width);
    }
    if (r.height > 0) {
      minScaleY = Math.max(minScaleY, minSize / r.height);
    }

    // Maximum constraint: r.width * sx <= maxSize => sx <= maxSize / r.width
    if (r.width > 0) {
      maxScaleX = Math.min(maxScaleX, maxSize / r.width);
    }
    if (r.height > 0) {
      maxScaleY = Math.min(maxScaleY, maxSize / r.height);
    }
  }

  // Clamp the desired scale
  sx = Math.max(minScaleX, Math.min(maxScaleX, sx));
  sy = Math.max(minScaleY, Math.min(maxScaleY, sy));

  return { x: sx, y: sy };
}

/**
 * Map a child rect from within `from` bounding box to the corresponding position
 * and size within `to` bounding box.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (from.width === 0 || from.height === 0) {
    return { ...child };
  }
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
