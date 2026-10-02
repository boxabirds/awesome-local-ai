/**
 * Pure world-unit geometry for selection and group transforms (story 7).
 * All functions are pure: no document, no DOM, no side effects.
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

/** The eight resize-handle positions on a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when every edge of `inner` lies inside (or on) `outer`. An object that
 * is only partly inside — or merely touches the boundary from outside — is not
 * contained (marquee rule, sel.marquee).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Union (smallest enclosing) rect of the given rects, or null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Smallest rect spanning points `a` and `b` (any quadrant). */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Resize `start` by dragging the given `handle` by `delta` (world units).
 * The opposite corner/edge stays fixed. With `aspectLocked`, the rect keeps
 * its start width-to-height ratio (the width axis is primary).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const growsRight = !handle.includes('w'); // 'w', 'nw', 'sw' drag the left edge
  const growsDown = !handle.includes('n'); // 'n', 'ne', 'nw' drag the top edge

  const isHorizontal = handle === 'e' || handle === 'w';
  const isVertical = handle === 'n' || handle === 's';

  let width = start.width;
  let height = start.height;
  if (!isVertical) {
    width = start.width + (growsRight ? delta.x : -delta.x);
  }
  if (!isHorizontal) {
    height = start.height + (growsDown ? delta.y : -delta.y);
  }
  if (aspectLocked && start.width > 0) {
    // Keep the start ratio: derive the height from the (primary) width.
    const ratio = start.height / start.width;
    if (isHorizontal) {
      height = width * ratio;
    } else if (isVertical) {
      width = height / ratio;
    } else {
      height = width * ratio;
    }
  }

  // Anchor on the opposite corner/edge.
  let x = start.x;
  let y = start.y;
  if (!growsRight) x = start.x + start.width - width;
  if (!growsDown) y = start.y + start.height - height;
  if (isHorizontal && aspectLocked) {
    // 'e'/'w' with aspect lock: keep the vertical centre fixed.
    y = start.y + (start.height - height) / 2;
  }
  if (isVertical && aspectLocked) {
    // 'n'/'s' with aspect lock: keep the horizontal centre fixed.
    x = start.x + (start.width - width) / 2;
  }

  return { x, y, width, height };
}

/**
 * Clamp a proposed (x, y) scale so that scaling every `rects[i]` by it keeps
 * each object within [minSizes[i], maxSize] on both axes. Returns the single
 * uniform (x, y) scale at which the first object reaches a limit (Key decision
 * 2: one clamp for the whole selection). Non-finite input scales are treated
 * as 1.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  let minX = 0;
  let maxX = Infinity;
  let minY = 0;
  let maxY = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const min = minSizes[i];
    if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
    if (r.width <= 0 || r.height <= 0) continue;
    if (Number.isFinite(min)) {
      minX = Math.max(minX, min / r.width);
      minY = Math.max(minY, min / r.height);
    }
    maxX = Math.min(maxX, maxSize / r.width);
    maxY = Math.min(maxY, maxSize / r.height);
  }
  const sx = Number.isFinite(scale.x) ? Math.min(Math.max(scale.x, minX), maxX) : 1;
  const sy = Number.isFinite(scale.y) ? Math.min(Math.max(scale.y, minY), maxY) : 1;
  return { x: sx, y: sy };
}

/** Map `child` from the `from` rect's space into the `to` rect's space. */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) return child;
  if (!Number.isFinite(child.width) || !Number.isFinite(child.height)) return child;
  // Mapping the source box onto the target box is exact: avoid a
  // width * (to.width / width) round-trip that introduces float error.
  if (
    child.x === from.x &&
    child.y === from.y &&
    child.width === from.width &&
    child.height === from.height
  ) {
    return { x: to.x, y: to.y, width: to.width, height: to.height };
  }
  if (from.width === 0 || from.height === 0) {
    return { x: to.x, y: to.y, width: to.width, height: to.height };
  }
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
