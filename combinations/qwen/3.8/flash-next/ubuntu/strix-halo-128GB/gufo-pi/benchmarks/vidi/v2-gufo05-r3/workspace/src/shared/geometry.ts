/**
 * Pure rectangle maths for board objects (story 7).
 *
 * Everything here is in world units unless a name says `screen`. The functions
 * are pure and total: invalid input (non-finite numbers, an empty list, a box
 * with no width) never throws — it returns `null`, the identity scale or the
 * input rectangle, so a gesture that receives garbage simply does nothing.
 */

/** A point in world units. Re-exported by `client/canvas/camera.ts`. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in world units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order a screen reader should meet them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The accessible name of a handle (PRD `sel.keyboard` accessibility). */
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when every number of the rectangle is finite. */
export function isRect(rect: Rect | null | undefined): rect is Rect {
  return (
    !!rect &&
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height)
  );
}

/** `outer` holds `inner` completely: all four edges of `inner` lie inside. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isRect(outer) || !isRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest rectangle holding every input rectangle, `null` when there is none. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const rect of rects) {
    if (!isRect(rect)) continue;
    seen = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return seen ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/** The rectangle between two points, in any order (a marquee in progress). */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finite(a?.x) || !finite(a?.y) || !finite(b?.x) || !finite(b?.y)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** The scale a handle drag asks for, per axis (1 = unchanged). */
export function resizeScale(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Point {
  if (!isRect(start) || start.width <= 0 || start.height <= 0) return { x: 1, y: 1 };
  if (!finite(delta?.x) || !finite(delta?.y)) return { x: 1, y: 1 };
  const movesX = handle.includes('e') || handle.includes('w');
  const movesY = handle.includes('n') || handle.includes('s');
  const signX = handle.includes('w') ? -1 : 1;
  const signY = handle.includes('n') ? -1 : 1;
  const dx = movesX ? delta.x * signX : 0;
  const dy = movesY ? delta.y * signY : 0;
  const sx = movesX ? (start.width + dx) / start.width : 1;
  const sy = movesY ? (start.height + dy) / start.height : 1;
  if (!aspectLocked) return { x: sx, y: sy };
  // The axis the pointer moved furthest along decides the new size, so a
  // diagonal drag with the mouse still feels like the handle is being pulled.
  const scale = Math.abs(dx) >= Math.abs(dy) ? sx : sy;
  return { x: scale, y: scale };
}

/** The fixed point of a handle: the opposite corner, or the opposite edge. */
export function resizeAnchor(start: Rect, handle: Handle): Point {
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  const left = handle.includes('w');
  const right = handle.includes('e');
  const top = handle.includes('n');
  const bottom = handle.includes('s');
  return {
    x: left ? start.x + start.width : right ? start.x : cx,
    y: top ? start.y + start.height : bottom ? start.y : cy,
  };
}

/** The rectangle `start` becomes when it is scaled about the handle's anchor. */
export function applyResizeScale(start: Rect, handle: Handle, scale: Point): Rect {
  if (!isRect(start)) return { x: 0, y: 0, width: 0, height: 0 };
  const sx = finite(scale?.x) && scale.x > 0 ? scale.x : 1;
  const sy = finite(scale?.y) && scale.y > 0 ? scale.y : 1;
  const anchor = resizeAnchor(start, handle);
  const width = Math.max(0, start.width * sx);
  const height = Math.max(0, start.height * sy);
  const movesX = handle.includes('e') || handle.includes('w');
  const movesY = handle.includes('n') || handle.includes('s');
  return {
    // An edge handle that does not move sideways keeps the box centred on the
    // anchor across that axis, which is what a ratio-locked edge resize needs.
    x: handle.includes('w') ? anchor.x - width : movesX ? anchor.x : anchor.x - width / 2,
    y: handle.includes('n') ? anchor.y - height : movesY ? anchor.y : anchor.y - height / 2,
    width,
    height,
  };
}

/**
 * Resize a bounding box by dragging one handle.
 *
 * Edge handles change one axis, corner handles two. With `aspectLocked` the
 * width-to-height ratio of the box is kept, growing or shrinking the other axis
 * about the anchor (the opposite corner, or the middle of the opposite edge).
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (
    !isRect(start) ||
    start.width <= 0 ||
    start.height <= 0 ||
    !finite(delta?.x) ||
    !finite(delta?.y)
  ) {
    return isRect(start) ? { ...start } : { x: 0, y: 0, width: 0, height: 0 };
  }
  if (!aspectLocked) {
    // Plain resize: exact edge arithmetic, so a drag of 100 units moves an edge
    // by 100 units and the number that reaches the document stays readable.
    let { x, y, width, height } = start;
    if (handle.includes('e')) width = Math.max(0, width + delta.x);
    if (handle.includes('w')) {
      const d = Math.min(delta.x, width);
      x += d;
      width -= d;
    }
    if (handle.includes('s')) height = Math.max(0, height + delta.y);
    if (handle.includes('n')) {
      const d = Math.min(delta.y, height);
      y += d;
      height -= d;
    }
    return { x, y, width, height };
  }
  return applyResizeScale(start, handle, resizeScale(start, handle, delta, true));
}

/**
 * The single scale factor a whole selection may apply.
 *
 * `rects[i]` is paired with `minSizes[i]` (its type's minimum size); the maximum
 * is one global setting. A scale is pulled back until no object crosses either
 * limit, so the selection stops as soon as the first object reaches one. A scale
 * that is uniform (`scale.x === scale.y`) stays uniform, otherwise the two axes
 * would stop at different object sizes and the layout would distort.
 *
 * The clamp never *increases* a scale: an object that is already past a limit
 * simply cannot be moved further in that direction.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (!finite(scale?.x) || !finite(scale?.y)) return { x: 1, y: 1 };
  let loX = 0;
  let loY = 0;
  let hiX = Number.POSITIVE_INFINITY;
  let hiY = Number.POSITIVE_INFINITY;
  let seen = false;
  rects.forEach((rect, index) => {
    if (!isRect(rect) || rect.width <= 0 || rect.height <= 0) return;
    const min = finite(minSizes[index]) ? Math.max(0, minSizes[index]!) : 0;
    const max = finite(maxSize) && maxSize > 0 ? maxSize : Number.POSITIVE_INFINITY;
    seen = true;
    loX = Math.max(loX, min / rect.width);
    loY = Math.max(loY, min / rect.height);
    hiX = Math.min(hiX, max / rect.width);
    hiY = Math.min(hiY, max / rect.height);
  });
  if (!seen) return { x: scale.x, y: scale.y };
  const clamp = (value: number, lo: number, hi: number) =>
    Math.min(Math.max(1, hi), Math.max(Math.min(1, lo), value));
  if (scale.x === scale.y) {
    // One scale for the whole selection: stop at the first limit hit on any axis.
    const lo = Math.max(loX, loY);
    const hi = Math.min(hiX, hiY);
    const value = clamp(scale.x, lo, hi);
    return { x: value, y: value };
  }
  return {
    x: clamp(scale.x, loX, hiX),
    y: clamp(scale.y, loY, hiY),
  };
}

/**
 * Map a rectangle from inside the box `from` to the same relative place in the
 * box `to` — the per-object step of a group resize.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isRect(child) || !isRect(from) || !isRect(to)) return child;
  const sx = from.width > 0 && finite(to.width) ? to.width / from.width : 1;
  const sy = from.height > 0 && finite(to.height) ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
