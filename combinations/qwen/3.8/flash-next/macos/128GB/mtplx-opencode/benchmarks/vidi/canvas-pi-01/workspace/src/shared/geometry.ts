/**
 * Story 7 · pure board geometry (design "Geometry and group operations").
 *
 * Rectangles and the two maths moves a group transform needs — the marquee's
 * fully-inside rule and the bounding-box resize — live here so they are testable
 * in Node with no DOM, no Yjs and no React. Every function is total: it never
 * throws and never reads outside its arguments. A `Rect` is `{ x, y, width,
 * height }` in world units; `Point` is a bare world coordinate.
 */

/** An axis-aligned rectangle in world units (`x`, `y` are the top-left). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A bare world coordinate. */
export interface Point {
  x: number;
  y: number;
}

/** One of the eight resize handles: four edges, four corners. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** True when `inner` lies **entirely** inside `outer` (edges touching counts). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rectangle enclosing every rect, or `null` when there are none.
 * Degenerate inputs (a single point) still yield a zero-area rect, not `null`.
 */
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

/**
 * Turn two opposite corners into a normalised rect (positive width/height,
 * top-left first). Used by the marquee: the drag start and the live pointer are
 * any two corners of the selection rectangle.
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
 * Resize a bounding box by dragging `handle` through `delta` (world units).
 *
 * Edge handles move one axis; corner handles move both. The box grows or shrinks
 * around the *opposite* corner/edge, which stays pinned. When `aspectLocked` the
 * width-to-height ratio of the box is held: the dominant axis of the drag drives
 * both, so a corner drag that moved (dx, dy) changes each edge by the larger of
 * the two (matching PRD `sel.aspect` and the "200×200 → 300×300" case).
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  // Which edges move, and the signed amount each moves by.
  const movesEast = handle === 'e' || handle === 'ne' || handle === 'se';
  const movesWest = handle === 'w' || handle === 'nw' || handle === 'sw';
  const movesSouth = handle === 's' || handle === 'se' || handle === 'sw';
  const movesNorth = handle === 'n' || handle === 'ne' || handle === 'nw';

  let { x, y, width, height } = start;

  if (movesEast) {
    width = start.width + delta.x;
  } else if (movesWest) {
    // Dragging the west edge right shrinks the box; the east edge is the anchor.
    x = start.x + delta.x;
    width = start.width - delta.x;
  }

  if (movesSouth) {
    height = start.height + delta.y;
  } else if (movesNorth) {
    y = start.y + delta.y;
    height = start.height - delta.y;
  }

  if (!aspectLocked) {
    return { x, y, width, height };
  }

  // Aspect lock: preserve the start ratio, anchored at the fixed corner/edge.
  // Use the axis that moved furthest (relative) to drive both so the ratio is
  // exactly the start ratio, never skewed.
  const ratio = start.height === 0 ? 1 : start.width / start.height;
  const dominant = Math.abs(width - start.width) >= Math.abs(height - start.height) ? width : height * ratio;
  const newWidth = dominant < 0 ? 0 : dominant;
  const newHeight = ratio === 0 ? newWidth : newWidth / ratio;

  if (movesWest) x = start.x + start.width - newWidth;
  if (movesNorth) y = start.y + start.height - newHeight;
  return { x, y, width: newWidth, height: newHeight };
}

/**
 * Clamp a requested anisotropic `(x, y)` scale so that, once applied with the
 * SAME factor to every rect, no object crosses its own `minSize` (per rect,
 * index-aligned) nor grows past `maxSize`. Each axis is clamped on its own so
 * an edge resize that only widens the box keeps only widening; the layout's
 * proportions are preserved because every object shares the returned scale. The
 * clamp stops at the first object to reach a limit on each axis (PRD
 * `sel.size_limits` / design Key decision 2). Non-finite input yields no
 * change. An empty input returns the request unchanged.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let sx = scale.x;
  let sy = scale.y;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return { x: 1, y: 1 };

  rects.forEach((r, index) => {
    const minSize = minSizes[index] ?? 0;
    if (r.width > 0) {
      if (sx > maxSize / r.width) sx = maxSize / r.width;
      if (sx < minSize / r.width) sx = minSize / r.width;
    }
    if (r.height > 0) {
      if (sy > maxSize / r.height) sy = maxSize / r.height;
      if (sy < minSize / r.height) sy = minSize / r.height;
    }
  });

  if (!Number.isFinite(sx) || sx <= 0) sx = 1;
  if (!Number.isFinite(sy) || sy <= 0) sy = 1;
  return { x: sx, y: sy };
}

/**
 * Map a `child` rect that lived inside the frame `from` to the same relative
 * spot inside the frame `to`: its position and size both scale by the frame's
 * width/height ratio. Used to resize every selected object from the one
 * clamped bounding-box scale.
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