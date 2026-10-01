/**
 * Story 7 (sel.geometry_ops): pure world-unit geometry for selection, marquee
 * and group resize. All coordinates are board units (1 unit = 1 px at zoom 1).
 * No Y.Doc, no DOM — the maths layer shared by the gesture code and tests.
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

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** True when `inner` lies entirely inside `outer` (touching edges counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

/** Smallest rect containing every rect. Null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
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

/** Axis-aligned rect between two points, in any direction. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize `start` by a world-unit `delta` from the given handle.
 *
 * - Corner handles change both axes; edge handles change one axis.
 * - `aspectLocked` keeps the start aspect ratio: the dominant axis delta
 *   determines the uniform scale (max |ratio| for corners, the changed axis
 *   for edges). Negative results clamp to 0.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const movesLeft = handle === 'w' || handle === 'nw' || handle === 'sw';
  const movesRight = handle === 'e' || handle === 'ne' || handle === 'se';
  const movesTop = handle === 'n' || handle === 'ne' || handle === 'nw';
  const movesBottom = handle === 's' || handle === 'se' || handle === 'sw';

  let width = start.width;
  let height = start.height;
  if (movesRight) width += delta.x;
  if (movesLeft) width -= delta.x;
  if (movesBottom) height += delta.y;
  if (movesTop) height -= delta.y;

  const x = movesLeft ? start.x + delta.x : start.x;
  const y = movesTop ? start.y + delta.y : start.y;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const rx = width / start.width;
    const ry = height / start.height;
    const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom);
    let s = isCorner ? Math.max(rx, ry) : movesLeft || movesRight ? rx : ry;
    if (!Number.isFinite(s)) s = 0;
    s = Math.max(s, 0);
    width = start.width * s;
    height = start.height * s;
  }

  return { x, y, width: Math.max(width, 0), height: Math.max(height, 0) };
}

/**
 * Clamp a per-axis (width, height) scale factor so that no object in `rects`
 * ends up with an edge below its entry in `minSizes` or above `maxSize`.
 *
 * - Scaling up: the largest scale that keeps every object ≤ maxSize.
 * - Scaling down: the smallest (closest to 1) scale that keeps every object ≥ its minimum.
 * - Scales already inside the limits are returned unchanged.
 * Per-axis, so a non-aspect-locked group can clamp independently on x/y.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  let sx = scale.x;
  let sy = scale.y;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      if (sx > 1) sx = Math.min(sx, maxSize / r.width);
      else if (sx < 1) sx = Math.max(sx, min / r.width);
    }
    if (r.height > 0) {
      if (sy > 1) sy = Math.min(sy, maxSize / r.height);
      else if (sy < 1) sy = Math.max(sy, min / r.height);
    }
  }
  return { x: sx, y: sy };
}

/**
 * Affine-map a child rect from one box (`from`) to another (`to`):
 * position relative to `from`, scaled by the box ratio, re-based on `to`.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
