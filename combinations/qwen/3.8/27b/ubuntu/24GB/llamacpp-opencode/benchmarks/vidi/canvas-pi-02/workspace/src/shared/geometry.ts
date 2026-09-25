import type { Point } from '../client/canvas/camera';

/**
 * Pure selection/resize geometry (story 7, sel.geometry_ops).
 *
 * All values are world units. `Point` doubles as a 2-D scale factor
 * ({x, y}). Functions are pure and total: non-finite input degrades
 * gracefully (see individual contracts) instead of throwing.
 */

/** Axis-aligned rectangle in world coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const EPS = 1e-9;

export function isValidRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height) &&
    r.width > 0 && r.height > 0
  );
}

/** `inner` fully inside `outer` (edge-touching counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

/** True when the point lies in the rect (edges included). */
export function pointInRect(r: Rect, p: Point): boolean {
  return p.x >= r.x - EPS && p.x <= r.x + r.width + EPS && p.y >= r.y - EPS && p.y <= r.y + r.height + EPS;
}

/** The smallest rect spanning both points (zero size allowed while dragging). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Union of valid rects; `null` for an empty (or all-invalid) list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (!isValidRect(r)) continue;
    if (!out) {
      out = { ...r };
    } else {
      const x2 = Math.max(out.x + out.width, r.x + r.width);
      const y2 = Math.max(out.y + out.height, r.y + r.height);
      out.x = Math.min(out.x, r.x);
      out.y = Math.min(out.y, r.y);
      out.width = x2 - out.x;
      out.height = y2 - out.y;
    }
  }
  return out;
}

/**
 * `child` re-expressed inside `to`: its position and size are scaled by the
 * from → to transform, so a layout scaled by the group keeps its relative
 * arrangement exactly.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 0;
  const sy = from.height > 0 ? to.height / from.height : 0;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}

/**
 * `start` scaled by `scale` about its handle anchors: the opposite side of
 * the handle stays fixed on an axis the handle touches, and the axis scales
 * about its centre otherwise (Key decision 3: the box keeps its ratio from
 * the opposite anchor).
 */
export function anchorBox(start: Rect, handle: Handle, scale: Point): Rect {
  const w = start.width * scale.x;
  const h = start.height * scale.y;
  const x = handle.includes('w')
    ? start.x + start.width - w
    : handle.includes('e')
      ? start.x
      : start.x + (start.width - w) / 2;
  const y = handle.includes('n')
    ? start.y + start.height - h
    : handle.includes('s')
      ? start.y
      : start.y + (start.height - h) / 2;
  return { x, y, width: w, height: h };
}

/**
 * New selection box after dragging `handle` by `delta` (world units).
 *
 * Edge handles change one axis, corner handles both. With `aspectLocked`,
 * the drag-dominant axis (larger |delta|; the only axis for edge handles)
 * sets one scale applied to both axes — the box keeps its ratio.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const affectsX = handle.includes('w') || handle.includes('e');
  const affectsY = handle.includes('n') || handle.includes('s');
  if (!aspectLocked) {
    const w = affectsX ? (handle.includes('e') ? start.width + delta.x : start.width - delta.x) : start.width;
    const h = affectsY ? (handle.includes('s') ? start.height + delta.y : start.height - delta.y) : start.height;
    return anchorBox(start, handle, {
      x: start.width > 0 ? w / start.width : 1,
      y: start.height > 0 ? h / start.height : 1,
    });
  }
  const dxAxis = affectsX ? (handle.includes('e') ? delta.x : -delta.x) : 0;
  const dyAxis = affectsY ? (handle.includes('s') ? delta.y : -delta.y) : 0;
  const sx = affectsX && start.width > 0 ? (start.width + dxAxis) / start.width : 1;
  const sy = affectsY && start.height > 0 ? (start.height + dyAxis) / start.height : 1;
  let s = 1;
  if (!affectsX) s = sy;
  else if (!affectsY) s = sx;
  else s = Math.abs(dxAxis) >= Math.abs(dyAxis) ? sx : sy;
  return anchorBox(start, handle, { x: s, y: s });
}

/**
 * Clamp a uniform scale so every rect stays inside `[minSizes[i], maxSize]`
 * on each axis; returns the single scale the whole selection stops at (the
 * first object to reach a limit wins, Key decision 2). Non-finite or
 * non-positive scale components are treated as 1 (no change) on that axis.
 */
export function clampScale(scale: Point, rects: readonly Rect[], minSizes: readonly number[], maxSize: number): Point {
  let sx = scale.x;
  let sy = scale.y;
  if (!Number.isFinite(sx) || sx <= 0) sx = 1;
  if (!Number.isFinite(sy) || sy <= 0) sy = 1;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = Number.isFinite(minSizes[i]) && (minSizes[i] as number) > 0 ? (minSizes[i] as number) : 0;
    if (r.width > 0) {
      if (min / r.width > sx) sx = min / r.width;
      if (maxSize / r.width < sx) sx = maxSize / r.width;
    }
    if (r.height > 0) {
      if (min / r.height > sy) sy = min / r.height;
      if (maxSize / r.height < sy) sy = maxSize / r.height;
    }
  }
  return { x: sx, y: sy };
}
