/**
 * Pure rectangle maths for selection, marquee and group transforms (story 7).
 *
 * All coordinates are world units. Functions are pure: they never mutate their
 * inputs and never throw on finite input. Callers are responsible for rejecting
 * non-finite inputs before they reach the document (see board-model group ops).
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

/** A resize handle on the selection's bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Human-readable name for each handle, used in `aria-label="Resize <position>"`. */
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** Every handle, in a stable order (useful for rendering). */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** True when `inner` lies entirely inside `outer` (edges touching counts as inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Smallest axis-aligned rect containing every input rect; null for an empty list. */
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

/** Axis-aligned rect spanned by two opposite corners, in any order. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function edgeOf(handle: Handle): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  return {
    left: handle === 'w' || handle === 'nw' || handle === 'sw',
    right: handle === 'e' || handle === 'ne' || handle === 'se',
    top: handle === 'n' || handle === 'nw' || handle === 'ne',
    bottom: handle === 's' || handle === 'sw' || handle === 'se',
  };
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units). The opposite
 * edge/corner is the fixed anchor. Edge handles move one axis, corner handles
 * both. When `aspectLocked`, the bounding box keeps its width:height ratio,
 * scaling from the anchor using the dominant axis of the drag.
 *
 * Result is normalised (non-negative size) so a drag past the anchor flips the
 * handle to the other side instead of producing a negative rect.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const { left, right, top, bottom } = edgeOf(handle);

  // Fixed edges (the anchor): the edge opposite the dragged handle stays put.
  const anchorLeft = !left; // left edge is fixed when the handle is on the right/centre
  const anchorTop = !top;

  // Tentative new edges from the drag.
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.width;
  let y1 = start.y + start.height;
  if (left) x0 = start.x + delta.x;
  if (right) x1 = start.x + start.width + delta.x;
  if (top) y0 = start.y + delta.y;
  if (bottom) y1 = start.y + start.height + delta.y;

  let width = x1 - x0;
  let height = y1 - y0;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    // Only a single-axis (edge) drag needs correction; corner drags keep the
    // pointer's diagonal by scaling to the larger relative change so the box
    // never grows in one axis while shrinking in the other.
    const horizontalOnly = !top && !bottom;
    const verticalOnly = !left && !right;

    if (horizontalOnly) {
      // width drives height; grow about the fixed vertical centre
      const cy = start.y + start.height / 2;
      height = Math.abs(width) / ratio;
      y0 = cy - height / 2;
      y1 = cy + height / 2;
    } else if (verticalOnly) {
      const cx = start.x + start.width / 2;
      width = Math.abs(height) * ratio;
      x0 = cx - width / 2;
      x1 = cx + width / 2;
    } else {
      // Corner: pick the axis with the larger relative scale and apply it to both.
      const scaleW = start.width !== 0 ? width / start.width : 1;
      const scaleH = start.height !== 0 ? height / start.height : 1;
      const scale = Math.abs(scaleW) >= Math.abs(scaleH) ? scaleW : scaleH;
      width = start.width * scale;
      height = start.height * scale;
      // Re-anchor: the fixed corner stays put.
      if (anchorLeft) x1 = x0 + width;
      else x0 = x1 - width;
      if (anchorTop) y1 = y0 + height;
      else y0 = y1 - height;
    }
  }

  return normalizeRect({ x: x0, y: y0 }, { x: x1, y: y1 });
}

/**
 * Clamp a scale factor so that no rect in `rects` crosses its per-object
 * `minSizes[i]` or the shared `maxSize` on either axis. Returns the single
 * largest uniform scale >= 1 or smallest <= 1 needed to keep every object legal,
 * preserving relative layout (every object scales by the same factor).
 *
 * Degenerate rects (zero width/height) are ignored for that axis.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let sx = scale.x;
  let sy = scale.y;
  // Scale > 1: shrink toward 1 if any object would exceed maxSize.
  // Scale < 1: raise toward 1 if any object would fall below its minSize.
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      const newW = r.width * sx;
      if (newW > maxSize) sx = maxSize / r.width;
      if (newW < min) sx = min / r.width;
    }
    if (r.height > 0) {
      const newH = r.height * sy;
      if (newH > maxSize) sy = maxSize / r.height;
      if (newH < min) sy = min / r.height;
    }
  }
  // If clamping one axis forced it away from the other, keep them consistent:
  // a scale that stops at the first limit stops the whole selection.
  if (scale.x === scale.y) {
    // Uniform input stays uniform; use the more restrictive of the two axes.
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    // But never past the direction the user dragged: if the clamp brought one
    // axis back past 1, don't overshoot the other past 1 either.
    const dir = scale.x >= 1 ? 1 : -1;
    const bounded = dir > 0 ? Math.min(s, sx, sy) : Math.max(s, sx, sy);
    return { x: bounded, y: bounded };
  }
  return { x: sx, y: sy };
}

/**
 * Map `child` from the coordinate frame of `from` to the frame of `to`, scaling
 * its position (relative to the box origin) and its size by the box scale.
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
