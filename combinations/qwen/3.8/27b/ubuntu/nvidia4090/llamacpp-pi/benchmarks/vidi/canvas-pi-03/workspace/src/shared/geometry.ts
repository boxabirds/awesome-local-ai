/**
 * Pure board geometry (story 7). World units throughout.
 *
 * These functions are framework-free and shared: the marquee and select-all
 * rules, the group-resize maths (bounding-box resize, scale clamping,
 * proportional re-layout) and the selection overlay all use them.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight bounding-box handles (compass names). */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/** True when `inner` lies entirely inside `outer` (touching edges counts). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest rect containing all of `rects`; null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!isFiniteRect(r)) return null;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rect spanned by two points, normalised to non-negative size. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resizes `start` from the given handle by a world-unit `delta`. Edge handles
 * change one axis, corner handles both. When `aspectLocked`, the result keeps
 * `start`'s width:height ratio, anchored at the opposite corner/edge: corner
 * handles use the larger of the two axis scales (the box always reaches the
 * pointer), edge handles use the scale of the axis the pointer drives.
 * The result is NOT clamped: the caller clamps via clampScale.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const hasE = handle === 'e' || handle === 'ne' || handle === 'se';
  const hasW = handle === 'w' || handle === 'nw' || handle === 'sw';
  const hasS = handle === 's' || handle === 'se' || handle === 'sw';
  const hasN = handle === 'n' || handle === 'ne' || handle === 'nw';

  let width = start.width;
  let height = start.height;
  if (hasE) width += delta.x;
  if (hasW) width -= delta.x;
  if (hasS) height += delta.y;
  if (hasN) height -= delta.y;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const wRatio = width / start.width;
    const hRatio = height / start.height;
    // Edge handles: the pointer drives one axis; corner handles: the box
    // always reaches the pointer (larger ratio wins).
    const scale = hasE !== hasW ? wRatio : hasS !== hasN ? hRatio : Math.max(wRatio, hRatio);
    width = start.width * scale;
    height = start.height * scale;
  }

  // Anchor at the opposite edge: the fixed side never moves.
  const x = hasW ? start.x + start.width - width : start.x;
  const y = hasN ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

/**
 * Clamps a bounding-box scale factor so that every rect in `rects` stays
 * within [minSizes[i], maxSize] on each axis after scaling. Returns the single
 * uniform clamped scale: the first object that would hit a limit stops the
 * whole selection (Key decision 2), keeping the relative layout.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let xLo = 0;
  let xHi = Infinity;
  let yLo = 0;
  let yHi = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      xLo = Math.max(xLo, min / r.width);
      xHi = Math.min(xHi, maxSize / r.width);
    }
    if (r.height > 0) {
      yLo = Math.max(yLo, min / r.height);
      yHi = Math.min(yHi, maxSize / r.height);
    }
  });
  const clampAxis = (v: number, lo: number, hi: number): number => {
    if (!Number.isFinite(v)) return 1; // invalid input: no change
    if (lo > hi) return (lo + hi) / 2; // contradictory bounds: split the difference
    return Math.min(Math.max(v, lo), hi);
  };
  return { x: clampAxis(scale.x, xLo, xHi), y: clampAxis(scale.y, yLo, yHi) };
}

/**
 * Scales a child rect proportionally from its position/size inside `from` to
 * the corresponding position/size inside `to`: offsets and size are scaled by
 * the to/from ratios per axis.
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
