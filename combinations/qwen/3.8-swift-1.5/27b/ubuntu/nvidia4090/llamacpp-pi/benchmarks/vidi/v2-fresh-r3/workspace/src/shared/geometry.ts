/**
 * Pure world-unit geometry for multi-selection (story 7). No Yjs, no DOM:
 * marquee containment, bounding boxes, handle resize maths and per-object
 * scaling. All inputs are board units.
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

/** One of the 8 bounding-box handles (N/E/S/W edges + 4 corners). */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Accessible name for a handle (sel.all_types / PRD a11y). */
export function handleLabel(h: Handle): string {
  const names: Record<Handle, string> = {
    nw: 'top-left',
    n: 'top',
    ne: 'top-right',
    e: 'right',
    se: 'bottom-right',
    s: 'bottom',
    sw: 'bottom-left',
    w: 'left',
  };
  return `Resize ${names[h]}`;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function isFiniteRect(r: Rect): boolean {
  return isFinitePoint(r) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/**
 * True when all four edges of `inner` lie inside `outer` (touching the edge
 * from inside counts; touching from outside does not). This is the marquee
 * containment rule (sel.marquee): partly-inside objects are not selected.
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

/** The smallest rect containing every rect; null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    if (!isFiniteRect(r)) continue;
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Axis-aligned rect spanned by two points (marquee drawing). */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!isFinitePoint(a) || !isFinitePoint(b)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resizes `start` from `handle` by the pointer `delta` (world units). The
 * opposite corner/edge is the fixed anchor. With `aspectLocked` the
 * width/height ratio of `start` is preserved, following the axis with the
 * larger relative change.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked = false): Rect {
  if (!isFiniteRect(start) || !isFinitePoint(delta)) return start;

  let width = start.width;
  let height = start.height;
  if (handle.includes('e')) width = start.width + delta.x;
  if (handle.includes('s')) height = start.height + delta.y;
  if (handle.includes('w')) width = start.width - delta.x;
  if (handle.includes('n')) height = start.height - delta.y;

  if (aspectLocked && start.width > 0 && start.height > 0) {
    const sx = width / start.width;
    const sy = height / start.height;
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    width = start.width * s;
    height = start.height * s;
  }

  let x = start.x;
  let y = start.y;
  if (handle.includes('w')) x = start.x + start.width - width;
  if (handle.includes('n')) y = start.y + start.height - height;
  return { x, y, width, height };
}

/**
 * Clamps a (non-uniform) scale so that no object in `rects` crosses its
 * `minSizes[i]` (when shrinking) or `maxSize` (when growing). Returns the
 * largest (or smallest) scale at which every object stays within both
 * limits — the whole selection stops when the first object reaches a limit
 * (sel.size_limits). Non-finite input → identity scale (no resize).
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y) || !Number.isFinite(maxSize)) {
    return { x: 1, y: 1 };
  }
  let sx = scale.x;
  let sy = scale.y;
  if (rects.length > 0) {
    if (sx > 1) {
      for (const r of rects) {
        if (r.width > 0) sx = Math.min(sx, maxSize / r.width);
      }
    } else if (sx < 1) {
      for (let i = 0; i < rects.length; i++) {
        if (rects[i].width > 0) sx = Math.max(sx, (minSizes[i] ?? 0) / rects[i].width);
      }
    }
    if (sy > 1) {
      for (const r of rects) {
        if (r.height > 0) sy = Math.min(sy, maxSize / r.height);
      }
    } else if (sy < 1) {
      for (let i = 0; i < rects.length; i++) {
        if (rects[i].height > 0) sy = Math.max(sy, (minSizes[i] ?? 0) / rects[i].height);
      }
    }
  }
  // A uniform (aspect-locked) scale must stay uniform after clamping, or the
  // object's proportions break at the min/max size (story 12: images keep
  // their proportions at the minimum size).
  if (scale.x === scale.y) {
    const s = scale.x < 1 ? Math.max(sx, sy) : Math.min(sx, sy);
    return { x: s, y: s };
  }
  return { x: sx, y: sy };
}

/**
 * Scales `child` (a rect inside `from`) into `to`: the child keeps its
 * relative position and size within the bounding box.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width !== 0 ? to.width / from.width : 0;
  const sy = from.height !== 0 ? to.height / from.height : 0;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
