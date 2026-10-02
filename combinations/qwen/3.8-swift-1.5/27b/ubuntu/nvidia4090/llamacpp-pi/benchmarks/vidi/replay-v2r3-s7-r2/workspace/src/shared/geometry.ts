/**
 * Pure geometry for the board (story 7, sel.geometry_ops). World units.
 *
 * All functions are pure — no Y.Doc, no DOM, no React.
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

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * True when `inner` lies entirely inside `outer` (touching the edges from
 * inside counts as inside; this is the marquee "fully inside" rule).
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Bounding box of all rects; null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.width < 0 || r.height < 0) continue;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Smallest positive rect spanning two arbitrary points. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Proposed result of dragging `handle` of `start` by `delta` (world units).
 *
 * - Not aspect-locked: the dragged corner/edge moves freely (the opposite
 *   corner/edge stays fixed).
 * - Aspect-locked: the scale factor comes from the primary axis (the x-axis
 *   for handles with an e/w component, the y-axis for n/s) and the rect is
 *   anchored on the opposite corner (corner handles) or edge midpoint
 *   (edge handles), so the aspect ratio is preserved around that anchor.
 *
 * May return negative sizes for extreme input; the caller clamps via
 * clampScale before writing.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const { x, y, width: w, height: h } = start;
  const { x: dx, y: dy } = delta;

  if (!aspectLocked) {
    let nx = x;
    let ny = y;
    let nw = w;
    let nh = h;
    if (handle.includes('e')) nw = w + dx;
    if (handle.includes('w')) {
      nx = x + dx;
      nw = w - dx;
    }
    if (handle.includes('s')) nh = h + dy;
    if (handle.includes('n')) {
      ny = y + dy;
      nh = h - dy;
    }
    return { x: nx, y: ny, width: nw, height: nh };
  }

  // Aspect-locked: uniform scale around the opposite corner/edge-midpoint.
  let factor: number;
  if (handle.includes('e') || handle.includes('w')) {
    factor = w !== 0 ? (w + (handle.includes('e') ? dx : -dx)) / w : 1;
  } else {
    factor = h !== 0 ? (h + (handle === 's' ? dy : -dy)) / h : 1;
  }
  const nw = w * factor;
  const nh = h * factor;
  return boxFromAnchor(start, handle, nw, nh);
}

/**
 * Rebuild a rect of size (w, h) anchored at the fixed (opposite) corner or
 * edge midpoint of `handle`, relative to the start rect.
 */
export function boxFromAnchor(start: Rect, handle: Handle, w: number, h: number): Rect {
  const { x, y, width: sw, height: sh } = start;
  switch (handle) {
    case 'se':
      return { x, y, width: w, height: h };
    case 'sw':
      return { x, y: y + sh - h, width: w, height: h };
    case 'ne':
      return { x: x + sw - w, y, width: w, height: h };
    case 'nw':
      return { x: x + sw - w, y: y + sh - h, width: w, height: h };
    case 'e':
      return { x, y: y + (sh - h) / 2, width: w, height: h };
    case 'w':
      return { x: x + sw - w, y: y + (sh - h) / 2, width: w, height: h };
    case 's':
      return { x: x + (sw - w) / 2, y, width: w, height: h };
    case 'n':
      return { x: x + (sw - w) / 2, y: y + sh - h, width: w, height: h };
  }
}

/**
 * Clamp a proposed (x, y) scale so that no object in `rects` ends up smaller
 * than its `minSizes` entry (shrinking) or larger than `maxSize` (growing).
 *
 * - Shrinking: each axis is clamped UP to the largest per-object minimum
 *   ratio, so the smallest object never drops below its minimum and every
 *   object stays ≥ its minimum.
 * - Growing: each axis is clamped DOWN to the smallest per-object maximum
 *   ratio, so no object exceeds `maxSize` on that axis.
 * - A non-positive scale on an axis is forced to that axis's minimum ratio
 *   (the degenerate flip-past-the-anchor case).
 *
 * The result is one uniform scale per axis for the whole selection, so the
 * relative layout of the group is preserved.
 */
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (rects.length === 0) return { x: scale.x, y: scale.y };

  const axis = (s: number, dim: (r: Rect) => number, mins: number[]): number => {
    if (s >= 1) {
      let out = s;
      for (let i = 0; i < rects.length; i++) {
        const d = dim(rects[i]);
        if (d > 0) out = Math.min(out, maxSize / d);
      }
      return out;
    }
    if (s > 0) {
      let out = s;
      for (let i = 0; i < rects.length; i++) {
        const d = dim(rects[i]);
        if (d > 0) out = Math.max(out, mins[i] / d);
      }
      return out;
    }
    let minRatio = 0;
    for (let i = 0; i < rects.length; i++) {
      const d = dim(rects[i]);
      if (d > 0) minRatio = Math.max(minRatio, mins[i] / d);
    }
    return minRatio;
  };

  return {
    x: axis(scale.x, (r) => r.width, minSizes),
    y: axis(scale.y, (r) => r.height, minSizes),
  };
}

/**
 * Map `child` (a rect inside `from`) into the correspondingly scaled position
 * and size inside `to`. Used to scale each object of a selection with the
 * group's bounding box.
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
