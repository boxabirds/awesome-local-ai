// Pure rectangle maths (sel.geometry_ops).
//
// Everything here is framework-free, DOM-free and side-effect-free: the marquee,
// the selection bounding box and the group resize are all computed with these
// functions so the same maths works for every kind of board object (stories
// 9–12 add types without touching the geometry).
//
// Units: every Rect / Point is in WORLD units unless the name says otherwise.

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

/** The eight bounding-box handles: four corners and four edges. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Screen-reader / aria names of the handles, in the order they render. */
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

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Tolerance for containment tests, so a rect that exactly touches the outer
 * edge counts as inside (floating-point safe). */
const EPS = 1e-6;

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** True when `inner` lies ENTIRELY inside `outer` (touching edges included).
 * Used by the marquee: a partly-inside object is never selected. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finite(outer.x, outer.y, outer.width, outer.height)) return false;
  if (!finite(inner.x, inner.y, inner.width, inner.height)) return false;
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

/** Smallest rect holding every input rect. Null for an empty list (the caller
 * then draws no bounding box and offers no handles). */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!finite(r.x, r.y, r.width, r.height)) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The axis-aligned rect between two dragged corners. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finite(a.x, a.y, b.x, b.y)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function affectsX(handle: Handle): boolean {
  return handle === 'w' || handle === 'nw' || handle === 'sw' || handle === 'e' || handle === 'ne' || handle === 'se';
}
function affectsY(handle: Handle): boolean {
  return handle === 'n' || handle === 'nw' || handle === 'ne' || handle === 's' || handle === 'sw' || handle === 'se';
}
/** True when the handle's LEFT edge moves (so the right edge is the anchor). */
function movesLeft(handle: Handle): boolean {
  return handle === 'w' || handle === 'nw' || handle === 'sw';
}
/** True when the handle's TOP edge moves (so the bottom edge is the anchor). */
function movesTop(handle: Handle): boolean {
  return handle === 'n' || handle === 'nw' || handle === 'ne';
}

/** Resize `start` by dragging `handle` by `delta` (world units), keeping the
 * opposite corner / edge fixed.
 *
 * With `aspectLocked` the width-to-height ratio of `start` is preserved: the
 * dominant axis of the delta decides the scale, so a diagonal drag on a corner
 * behaves like a natural proportional scale (TC-01: 200×200 + (100,40) on `se`
 * → 300×300).
 *
 * The result may be smaller / larger than the legal limits — `clampScale` is
 * what stops a resize at a limit.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!finite(start.x, start.y, start.width, start.height) || !finite(delta.x, delta.y)) return start;

  const sx = affectsX(handle) ? 1 + (movesLeft(handle) ? -delta.x : delta.x) / start.width : 1;
  const sy = affectsY(handle) ? 1 + (movesTop(handle) ? -delta.y : delta.y) / start.height : 1;

  let fx = sx;
  let fy = sy;
  if (aspectLocked) {
    const dx = affectsX(handle) ? Math.abs(delta.x) : -1;
    const dy = affectsY(handle) ? Math.abs(delta.y) : -1;
    const s = dx >= dy ? sx : sy;
    fx = s;
    fy = s;
  }
  return anchorRect(start, handle, start.width * fx, start.height * fy);
}

/** The rect of the given size whose anchored corner/edge of `start` stays put.
 * Exported so a gesture can rebuild the target box from a clamped scale using
 * exactly the same anchor rule. */
export function anchorRect(start: Rect, handle: Handle, width: number, height: number): Rect {
  const x = movesLeft(handle) ? start.x + start.width - width : start.x;
  const y = movesTop(handle) ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

/** Clamp a requested scale so that NO object crosses its own size limits.
 *
 * `scale` is per axis (an aspect-locked selection asks for x === y, in which
 * case the answer is uniform too, so the layout cannot distort). `minSizes[i]`
 * is the minimum side of the object whose rect is `rects[i]`; `maxSize` is the
 * global maximum side.
 *
 * Key design decision: the scale is clamped ONCE for the whole selection, at
 * the scale where the FIRST object reaches a limit — otherwise objects would
 * stop at different times and the arrangement would warp.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (!finite(scale.x, scale.y) || scale.x <= 0 || scale.y <= 0) return { x: 1, y: 1 };
  const applyMax = Number.isFinite(maxSize) && maxSize > 0;
  let lo = 0;
  let hi = Infinity;
  rects.forEach((r, i) => {
    const min = Number.isFinite(minSizes[i]) && minSizes[i] > 0 ? minSizes[i] : 0;
    for (const extent of [r.width, r.height]) {
      if (!finite(extent) || extent <= 0) continue;
      if (applyMax) hi = Math.min(hi, maxSize / extent);
      lo = Math.max(lo, min / extent);
    }
  });
  if (lo > hi) lo = hi; // already illegal (e.g. zero-size rect): stay put
  const clampAxis = (s: number) => clamp(s, lo, hi);
  if (scale.x === scale.y) {
    const s = clampAxis(scale.x);
    return { x: s, y: s };
  }
  return { x: clampAxis(scale.x), y: clampAxis(scale.y) };
}

/** Map `child` from living inside `from` to living inside `to`, scaling its size
 * AND its position — this is what makes a group resize keep the layout. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (
    !finite(child.x, child.y, child.width, child.height) ||
    !finite(from.x, from.y, from.width, from.height) ||
    !finite(to.x, to.y, to.width, to.height) ||
    from.width <= 0 ||
    from.height <= 0
  ) {
    return child;
  }
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const out = {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
  if (!finite(out.x, out.y, out.width, out.height)) return child;
  return out;
}
