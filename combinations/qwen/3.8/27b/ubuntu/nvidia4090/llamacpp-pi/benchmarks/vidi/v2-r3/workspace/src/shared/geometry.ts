/**
 * Pure world-space geometry for the board (story 7, sel.geometry_ops).
 *
 * Framework-free: used by the shared board model and the client. World
 * units are board coordinates (see src/client/canvas/camera.ts for the
 * world <-> screen mapping).
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

export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Human-readable handle position, used for the `Resize <position>` labels. */
export const HANDLE_NAMES: Record<Handle, string> = {
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
  nw: 'top-left',
};

/**
 * True when every edge of `inner` lies on or inside `outer` (the
 * fully-inside rule of the marquee; inclusive edges).
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
 * Smallest rect containing every rect; `null` for an empty list.
 */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Axis-aligned rect spanned by two points (zero size allowed: a click,
 * not a drag).
 */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * `start` resized by dragging `handle` by `delta` (world units). Edge
 * handles change one axis; corner handles both; the opposite corner is
 * the anchor. With `aspectLocked` the box keeps its width-to-height
 * ratio: edge handles follow their axis (the perpendicular axis follows
 * the ratio); corner handles use the dominant axis (larger absolute
 * delta) as the scale.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const hasW = handle === 'w' || handle === 'nw' || handle === 'sw';
  const hasE = handle === 'e' || handle === 'ne' || handle === 'se';
  const hasN = handle === 'n' || handle === 'ne' || handle === 'nw';
  const hasS = handle === 's' || handle === 'se' || handle === 'sw';

  // Width/height change implied by the delta for this handle.
  const incX = (hasE ? delta.x : 0) - (hasW ? delta.x : 0);
  const incY = (hasS ? delta.y : 0) - (hasN ? delta.y : 0);

  const isCorner = (hasW || hasE) && (hasN || hasS);
  let width: number;
  let height: number;
  if (!aspectLocked) {
    width = start.width + incX;
    height = start.height + incY;
  } else {
    const ratio = start.width > 0 && start.height > 0 ? start.width / start.height : 1;
    if (!isCorner) {
      // Pure edge: the axis the handle controls follows the delta, the
      // perpendicular axis follows the ratio.
      if (hasW || hasE) {
        width = start.width + incX;
        height = width / ratio;
      } else {
        height = start.height + incY;
        width = height * ratio;
      }
    } else {
      // Corner: the dominant axis (larger absolute delta) sets the scale.
      if (start.width <= 0 || start.height <= 0) {
        const s = Math.max(Math.abs(incX), Math.abs(incY));
        width = s;
        height = s / ratio;
      } else {
        const sx = (start.width + incX) / start.width;
        const sy = (start.height + incY) / start.height;
        const scale = Math.abs(delta.x) >= Math.abs(delta.y) ? sx : sy;
        width = start.width * scale;
        height = start.height * scale;
      }
    }
  }

  const x = hasW ? start.x + delta.x : start.x;
  const y = hasN ? start.y + delta.y : start.y;
  return { x, y, width, height };
}

/**
 * Clamp a proposed per-axis scale so that no child rect crosses
 * `minSizes[i]` (per object, same minimum on both axes) or `maxSize`.
 * Equivalent to: the largest scale at which no object is smaller than
 * its minimum, or the smallest scale at which no object exceeds
 * `maxSize` — whichever keeps the selection moving as a whole up to the
 * first object that reaches a limit. x and y are clamped independently.
 * Zero-size rects impose no constraint; non-finite input is sanitised
 * against its other axis (an aspect-locked group proposes equal scales).
 */
export function clampScale(scale: Point, rects: readonly Rect[], minSizes: readonly number[], maxSize: number): Point {
  let sx = Number.isFinite(scale.x) ? scale.x : scale.y;
  let sy = Number.isFinite(scale.y) ? scale.y : scale.x;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    sx = 1;
    sy = 1;
  }

  let loX = 0;
  let hiX = Infinity;
  let loY = 0;
  let hiY = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    const min = Number.isFinite(minSizes[i]) ? minSizes[i] : 0;
    if (Number.isFinite(r.width) && r.width > 0) {
      loX = Math.max(loX, min / r.width);
      hiX = Math.min(hiX, maxSize / r.width);
    }
    if (Number.isFinite(r.height) && r.height > 0) {
      loY = Math.max(loY, min / r.height);
      hiY = Math.min(hiY, maxSize / r.height);
    }
  }

  sx = Math.min(Math.max(sx, loX), hiX);
  sy = Math.min(Math.max(sy, loY), hiY);
  return { x: sx, y: sy };
}

/**
 * Re-map `child` from the box `from` to the box `to`: proportional
 * repositioning and scaling. Zero-sized `from` maps the child to the top
 * left of `to` with zero size (no division by zero).
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const fx = from.width > 0 ? (child.x - from.x) / from.width : 0;
  const fy = from.height > 0 ? (child.y - from.y) / from.height : 0;
  const sx = from.width > 0 ? to.width / from.width : 0;
  const sy = from.height > 0 ? to.height / from.height : 0;
  return {
    x: to.x + fx * to.width,
    y: to.y + fy * to.height,
    width: child.width * sx,
    height: child.height * sy,
  };
}
