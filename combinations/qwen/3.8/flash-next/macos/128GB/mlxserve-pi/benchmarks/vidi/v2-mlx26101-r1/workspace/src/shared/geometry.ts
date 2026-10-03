// Pure rectangle maths for story 7's selection, marquee and transform gesture.
//
// Everything here is world-unit arithmetic with no Yjs, DOM or React in it, so
// the group operations in board-model and the gesture hook can share one set of
// rules for "is this inside", "what is the bounding box", "how does this handle
// resize the box" and "how does an object scale inside a resized box". A `Point`
// and a `Rect` are declared here (rather than imported from the client camera) so
// the shared layer stays free of client code; they are structurally identical.

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

/** The eight resize handles of a bounding box, named by compass position. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * Floating-point tolerance so an object whose edge lies exactly on the marquee
 * edge counts as inside (the PRD only excludes objects "partly inside" or that
 * "touch the edge from outside"), and so aspect/scale ratios round-trip.
 */
const EPS = 1e-9;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** True when `inner` lies entirely within `outer` (a shared edge is inside). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

/**
 * Smallest axis-aligned rectangle enclosing every finite rect, or null when the
 * list holds none. Non-finite rects are skipped rather than poisoning the result.
 */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const r of rects) {
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.width) ||
      !isFiniteNumber(r.height)
    ) {
      continue;
    }
    found = true;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  if (!found) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The rectangle with two opposite corners at `a` and `b` (any drag direction). */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Which edges of the box a handle drags. */
function affectsRight(h: Handle): boolean {
  return h === 'e' || h === 'ne' || h === 'se';
}
function affectsLeft(h: Handle): boolean {
  return h === 'w' || h === 'nw' || h === 'sw';
}
function affectsBottom(h: Handle): boolean {
  return h === 's' || h === 'se' || h === 'sw';
}
function affectsTop(h: Handle): boolean {
  return h === 'n' || h === 'ne' || h === 'nw';
}

/**
 * Resize `start` by dragging `handle` by `delta` (world units). Edge handles
 * change one axis, corner handles both; the opposite corner or edge stays put.
 * When `aspectLocked` the box keeps its width-to-height ratio — the dominant
 * axis drives, and a single-edge handle grows the other axis symmetrically about
 * the centre so the box stays centred on the axis it is not being dragged along.
 * Size limits are not applied here (that is `clampScale`); only the ratio is.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) return { ...start };

  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const centerX = start.x + start.width / 2;
  const centerY = start.y + start.height / 2;

  const xEdge = affectsRight(handle) || affectsLeft(handle);
  const yEdge = affectsBottom(handle) || affectsTop(handle);

  let w = start.width;
  let h = start.height;
  if (affectsRight(handle)) w = start.width + delta.x;
  else if (affectsLeft(handle)) w = start.width - delta.x;
  if (affectsBottom(handle)) h = start.height + delta.y;
  else if (affectsTop(handle)) h = start.height - delta.y;

  if (aspectLocked) {
    const rx = xEdge ? w / start.width : 1;
    const ry = yEdge ? h / start.height : 1;
    let ratio: number;
    if (xEdge && yEdge) {
      // Corner: whichever axis moved further drives the shared ratio.
      ratio = Math.abs(w - start.width) >= Math.abs(h - start.height) ? rx : ry;
    } else if (xEdge) ratio = rx;
    else ratio = ry;
    w = start.width * ratio;
    h = start.height * ratio;
  }

  // Position from the fixed edges (opposite the dragged ones).
  let x = affectsLeft(handle) ? right - w : start.x;
  let y = affectsTop(handle) ? bottom - h : start.y;
  if (aspectLocked) {
    // A single-edge handle grows the other axis about the box centre.
    if (xEdge && !yEdge) y = centerY - h / 2;
    if (yEdge && !xEdge) x = centerX - w / 2;
  }
  return { x, y, width: w, height: h };
}

/**
 * Clamp a bounding-box scale so no object crosses its type's `minSizes[i]` (from
 * below) or `maxSize` (from above). Returns the single scale to apply to the
 * whole selection — the point at which the first object reaches a limit — so the
 * layout never distorts by stopping some objects and not others (Key decision 2).
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  let sx = isFiniteNumber(scale.x) ? scale.x : 1;
  let sy = isFiniteNumber(scale.y) ? scale.y : 1;
  let minSx = 0;
  let minSy = 0;
  let maxSx = Infinity;
  let maxSy = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    const min = isFiniteNumber(minSizes[i]) && minSizes[i] > 0 ? minSizes[i] : 1;
    if (isFiniteNumber(maxSize) && maxSize > 0) {
      maxSx = Math.min(maxSx, maxSize / r.width);
      maxSy = Math.min(maxSy, maxSize / r.height);
    }
    minSx = Math.max(minSx, min / r.width);
    minSy = Math.max(minSy, min / r.height);
  }
  sx = clamp(sx, Math.min(minSx, maxSx), Math.max(minSx, maxSx));
  sy = clamp(sy, Math.min(minSy, maxSy), Math.max(minSy, maxSy));
  return { x: sx, y: sy };
}

/**
 * Map `child` from the `from` box to the same relative place in the `to` box:
 * both position and size scale by the box's width/height ratios. This is how a
 * group resize moves and grows every object at once while keeping their layout.
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
