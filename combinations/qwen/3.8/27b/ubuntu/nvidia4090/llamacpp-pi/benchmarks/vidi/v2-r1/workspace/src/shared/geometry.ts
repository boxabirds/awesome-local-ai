/**
 * Story 7 — shared geometry.
 *
 * Pure, framework-free helpers for marquee selection, bounding boxes and
 * transform gestures. Used by the client (and by any future tooling);
 * nothing here depends on React, the DOM or Yjs.
 *
 * Coordinate conventions:
 * - All rects are in *world* units with a top-left origin (matching the
 *   board-model `x`/`y`).
 * - A `Rect` has non-negative `width` and `height`. A resize *candidate*
 *   that crosses an edge is clamped at zero here; `clampScale` then brings
 *   it back to the feasible range (min/max object size).
 */

/** A 2D point (world units unless stated otherwise). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle: top-left corner + size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The eight bounding-box handle positions, clockwise from top-left. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * The marquee's containment rule: `inner` must lie entirely inside `outer`
 * (edges touching count as contained).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** True when the point lies inside (or exactly on) the rectangle. */
export function pointInRect(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x &&
    p.y >= rect.y &&
    p.x <= rect.x + rect.width &&
    p.y <= rect.y + rect.height
  );
}

/** Union of a non-empty list of rects; `null` for an empty list. */
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

/** Non-negative rect spanned by two points (drag start → current). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Place a box of the given size so the given handle's anchor stays put:
 * 'e' keeps the left edge, 'w' the right edge, 'n' the bottom edge,
 * 's' the top edge; edge handles keep the opposite axis centred.
 */
export function anchoredBox(
  start: Rect,
  handle: Handle,
  width: number,
  height: number,
): Rect {
  const x = handle.includes('e')
    ? start.x
    : handle.includes('w')
      ? start.x + start.width - width
      : start.x + (start.width - width) / 2;
  const y = handle.includes('s')
    ? start.y
    : handle.includes('n')
      ? start.y + start.height - height
      : start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

/**
 * Candidate box after dragging `handle` by `delta`.
 *
 * Without the aspect lock each axis moves independently (corner handles
 * change both, edge handles only their own axis). With the lock, the
 * candidate is square-ish again: the axis whose *scale* is larger drives,
 * and both dimensions are scaled by that factor (a drag that would cross
 * an edge clamps the driven size at zero, never negative).
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width = Math.max(0, start.width + delta.x);
  if (handle.includes('w')) width = Math.max(0, start.width - delta.x);
  if (handle.includes('s')) height = Math.max(0, start.height + delta.y);
  if (handle.includes('n')) height = Math.max(0, start.height - delta.y);

  if (aspectLocked) {
    const sx = start.width > 0 ? width / start.width : 1;
    const sy = start.height > 0 ? height / start.height : 1;
    // The axis whose scale is larger drives; scales are non-negative.
    const s = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
    width = start.width * s;
    height = start.height * s;
  }
  return anchoredBox(start, handle, width, height);
}

/**
 * Clamp a per-axis scale so every object ends up within its feasible
 * size range: `minSizes[i]` ≤ size ≤ `maxSize` on both axes.
 *
 * The clamp is a *single* per-axis factor: the candidate is adopted when
 * it is feasible, otherwise it is pulled back to the nearest bound. This
 * keeps all objects on one common transform, so relative sizes and gaps
 * are preserved (nothing per-object clamps while its neighbours do not).
 *
 * A non-finite input scale is treated as `{ x: 1, y: 1 }` (identity); an
 * empty object list yields the identity scale as well.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return { x: 1, y: 1 };
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y)) {
    return { x: 1, y: 1 };
  }
  let loX = 0;
  let hiX = Infinity;
  let loY = 0;
  let hiY = Infinity;
  rects.forEach((r, i) => {
    const min = Number.isFinite(minSizes[i]) && minSizes[i] > 0 ? minSizes[i] : 0;
    if (r.width > 0) {
      loX = Math.max(loX, min / r.width);
      hiX = Math.min(hiX, maxSize / r.width);
    }
    if (r.height > 0) {
      loY = Math.max(loY, min / r.height);
      hiY = Math.min(hiY, maxSize / r.height);
    }
  });
  const clamp = (s: number, lo: number, hi: number): number => {
    if (s > 1) return Math.min(s, hi);
    if (s < 1) return Math.max(s, lo);
    return s;
  };
  return { x: clamp(scale.x, loX, hiX), y: clamp(scale.y, loY, hiY) };
}

/**
 * Map `child` (positioned within `from`) into the identically anchored
 * `to` box: offsets and sizes scale by the `from` → `to` ratios, so
 * relative layout (sizes *and* gaps) is preserved.
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
