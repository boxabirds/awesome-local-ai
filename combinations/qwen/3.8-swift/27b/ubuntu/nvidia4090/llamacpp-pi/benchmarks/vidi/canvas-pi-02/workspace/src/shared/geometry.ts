// Pure selection geometry (story 7, sel.geometry_ops): world-unit rects,
// marquee containment, bounding-box resize and proportional scaling.
// No DOM, no React, no Yjs.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The 8 resize-handle positions of a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Accessible names for the handles ("Resize top-left" …). */
export const HANDLE_NAMES: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/**
 * True when `inner` lies ENTIRELY inside `outer` (half-open intervals: an
 * object exactly touching the edge without enclosing is not contained — the
 * marquee rule from the PRD).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The bounding box of all rects, or null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
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

/** Order-independent rect between two points (marquee dragging). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Resizes `start` by dragging `handle` by `delta` (world units).
 *
 * Without an aspect lock the dragged edge(s) move by `delta` and the rest of
 * the box is anchored. With an aspect lock the box keeps its width/height
 * ratio, anchored at the opposite corner/edge: the uniform scale is the
 * DOMINANT (largest magnitude) axis scale, so a 200×200 box dragged (100, 40)
 * on `se` becomes 300×300 (scale 1.5 beats 1.2).
 *
 * A non-finite delta yields a non-finite rect; callers must clamp first
 * (`clampScale` rejects non-finite values).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  if (!aspectLocked) {
    // The dragged edge moves with the delta: `w`/`n` shrink (positive delta
    // moves the left/top edge IN), `e`/`s` grow.
    const width = hasE ? start.width + delta.x : hasW ? start.width - delta.x : start.width;
    const height = hasS ? start.height + delta.y : hasN ? start.height - delta.y : start.height;
    const x = hasW ? start.x + delta.x : start.x;
    const y = hasN ? start.y + delta.y : start.y;
    return { x, y, width, height };
  }

  // Aspect-locked: compute the requested scale on each axis the handle can
  // move, take the DOMINANT (largest magnitude) as the uniform scale, and
  // re-anchor at the opposite corner/edge.
  const reqX = hasE
    ? (start.width + delta.x) / start.width
    : hasW
      ? (start.width - delta.x) / start.width
      : 1;
  const reqY = hasS
    ? (start.height + delta.y) / start.height
    : hasN
      ? (start.height - delta.y) / start.height
      : 1;
  const s = Math.max(Math.abs(reqX), Math.abs(reqY));
  const width = start.width * s;
  const height = start.height * s;
  const x = hasW ? start.x + start.width - width : start.x;
  const y = hasN ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

/**
 * Clamps a resize scale per axis against every object's minimum size and the
 * global maximum: `scale.x` is limited so that no `rects[i] * scale.x` falls
 * below `minSizes[i]` (per object) or above `maxSize`. A non-finite input
 * scale is replaced by the minimum bound. The clamped scale preserves the
 * relative layout of the group (it is one uniform factor per axis).
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (rects.length === 0) return scale;
  let sxMin = 0;
  let sxMax = Infinity;
  let syMin = 0;
  let syMax = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    const min = minSizes[i] ?? 0;
    if (Number.isFinite(r.width) && r.width > 0) {
      sxMin = Math.max(sxMin, min / r.width);
      sxMax = Math.min(sxMax, maxSize / r.width);
    }
    if (Number.isFinite(r.height) && r.height > 0) {
      syMin = Math.max(syMin, min / r.height);
      syMax = Math.min(syMax, maxSize / r.height);
    }
  }
  const sx = Number.isFinite(scale.x) ? Math.min(Math.max(scale.x, sxMin), sxMax) : sxMin;
  const sy = Number.isFinite(scale.y) ? Math.min(Math.max(scale.y, syMin), syMax) : syMin;
  return { x: sx, y: sy };
}

/**
 * Maps a child rect from the `from` box into the `to` box, preserving the
 * child's relative position and size inside the box (group resize).
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
