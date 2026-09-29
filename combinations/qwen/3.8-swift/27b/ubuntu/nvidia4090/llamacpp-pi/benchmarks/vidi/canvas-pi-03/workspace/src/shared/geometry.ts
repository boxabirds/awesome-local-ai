/**
 * Story 7: pure world-unit geometry shared by marquee selection, group
 * move/resize and the selection overlay. All values are board units (world
 * units); nothing here touches the Y.Doc or the DOM.
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

export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Human-readable handle positions, used for the "Resize <position>" labels. */
export const HANDLE_LABELS: Record<Handle, string> = {
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
  nw: 'top-left',
};

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

/**
 * True when `inner` lies entirely inside `outer` (touching edges counts as
 * inside). The marquee rule: partially enclosed objects are NOT selected.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Union (smallest enclosing rect) of the given rects, or null when empty. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!isFiniteRect(r) || r.width < 0 || r.height < 0) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Rect spanning two points (any order), normalised to non-negative size. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Smallest positive width/height so a flipped drag never yields zero size. */
const MIN_RECT_SIZE = 1;

/**
 * Resizes `start` by dragging `handle` by `delta` (world units).
 *
 * - Corner handles change both axes; edge handles change one axis.
 * - When `aspectLocked`, the width-to-height ratio is kept: the axis aligned
 *   with the drag direction drives the scale, the other axis follows. The
 *   opposite corner/edge midpoint is the fixed anchor.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!isFiniteRect(start) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return { ...start };
  }

  if (!aspectLocked) {
    switch (handle) {
      case 'e':
        return { x: start.x, y: start.y, width: Math.max(start.width + delta.x, MIN_RECT_SIZE), height: start.height };
      case 'w': {
        const width = Math.max(start.width - delta.x, MIN_RECT_SIZE);
        return { x: start.x + (start.width - width), y: start.y, width, height: start.height };
      }
      case 's':
        return { x: start.x, y: start.y, width: start.width, height: Math.max(start.height + delta.y, MIN_RECT_SIZE) };
      case 'n': {
        const height = Math.max(start.height - delta.y, MIN_RECT_SIZE);
        return { x: start.x, y: start.y + (start.height - height), width: start.width, height };
      }
      case 'se':
        return { x: start.x, y: start.y, width: Math.max(start.width + delta.x, MIN_RECT_SIZE), height: Math.max(start.height + delta.y, MIN_RECT_SIZE) };
      case 'sw': {
        const width = Math.max(start.width - delta.x, MIN_RECT_SIZE);
        return { x: start.x + (start.width - width), y: start.y, width, height: Math.max(start.height + delta.y, MIN_RECT_SIZE) };
      }
      case 'ne': {
        const width = Math.max(start.width + delta.x, MIN_RECT_SIZE);
        return { x: start.x, y: start.y + (start.height - Math.max(start.height - delta.y, MIN_RECT_SIZE)), width, height: Math.max(start.height - delta.y, MIN_RECT_SIZE) };
      }
      case 'nw': {
        const width = Math.max(start.width - delta.x, MIN_RECT_SIZE);
        const height = Math.max(start.height - delta.y, MIN_RECT_SIZE);
        return { x: start.x + (start.width - width), y: start.y + (start.height - height), width, height };
      }
    }
  }

  // Aspect-locked: the drag-direction axis drives the scale.
  let width: number;
  let height: number;
  if (handle === 'n' || handle === 's') {
    // Vertical edge: height drives the scale.
    height = Math.max(handle === 's' ? start.height + delta.y : start.height - delta.y, MIN_RECT_SIZE);
    width = (start.width * height) / start.height;
  } else if (handle === 'e' || handle === 'w') {
    // Horizontal edge: width drives the scale.
    width = Math.max(handle === 'e' ? start.width + delta.x : start.width - delta.x, MIN_RECT_SIZE);
    height = (start.height * width) / start.width;
  } else if (handle === 'se' || handle === 'sw') {
    // Bottom corners: width drives the scale.
    width = Math.max(handle === 'se' ? start.width + delta.x : start.width - delta.x, MIN_RECT_SIZE);
    height = (start.height * width) / start.width;
  } else {
    // Top corners (ne, nw): width drives the scale.
    width = Math.max(handle === 'ne' ? start.width + delta.x : start.width - delta.x, MIN_RECT_SIZE);
    height = (start.height * width) / start.width;
  }

  let x = start.x;
  let y = start.y;
  const dxWidth = start.width - width;
  const dyHeight = start.height - height;
  if (handle === 'w' || handle === 'sw' || handle === 'nw') x = start.x + dxWidth;
  if (handle === 'n' || handle === 'nw' || handle === 'ne') y = start.y + dyHeight;
  if (handle === 'e' || handle === 'w') y = start.y + dyHeight / 2; // anchor: opposite edge midpoint
  if (handle === 'n' || handle === 's') x = start.x + dxWidth / 2; // anchor: opposite edge midpoint

  return { x, y, width, height };
}

/**
 * Clamps a (sx, sy) scale so no rect crosses its per-object min size or the
 * global max size, returning one uniform clamped scale. The whole selection
 * stops when the FIRST object reaches its limit (keeps the layout intact).
 */
export function clampScale(scale: Point, rects: readonly Rect[], minSizes: readonly number[], maxSize: number): Point {
  let sx = scale.x;
  let sy = scale.y;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sy < 0) return { x: 0, y: 0 };
  let loX = 0;
  let loY = 0;
  let hiX = Infinity;
  let hiY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const minSize = minSizes[i] ?? 0;
    if (!isFiniteRect(r) || r.width <= 0 || r.height <= 0) continue;
    loX = Math.max(loX, minSize / r.width);
    loY = Math.max(loY, minSize / r.height);
    hiX = Math.min(hiX, maxSize / r.width);
    hiY = Math.min(hiY, maxSize / r.height);
  }
  // The whole selection stops when the FIRST object reaches a limit.
  const cx = Math.max(loX, Math.min(sx, hiX));
  const cy = Math.max(loY, Math.min(sy, hiY));
  return { x: Math.max(cx, 0), y: Math.max(cy, 0) };
}

/**
 * Maps a child rect from the `from` box into the `to` box: position scales
 * relative to `from`, size scales by the from→to ratio on each axis.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(child) || !isFiniteRect(from) || !isFiniteRect(to)) {
    return { ...child };
  }
  if (from.width <= 0 || from.height <= 0) {
    return { x: to.x, y: to.y, width: child.width, height: child.height };
  }
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: from.x + (child.x - from.x) * sx,
    y: from.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
