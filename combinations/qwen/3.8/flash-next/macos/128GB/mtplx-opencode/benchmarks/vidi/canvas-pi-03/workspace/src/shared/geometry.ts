// Pure number-only geometry shared by the SelectionController and the transform
// gesture. Everything here is unit-testable in Node: no DOM, no PointerEvent,
// no React and no coordinate conversion. Coordinates are plain numbers.

/** A rectangle in world space (a screen-space rect is the same shape). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles: four corners + four edges. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Point {
  x: number;
  y: number;
}

/** True when every component is finite and width/height are strictly positive. */
export function isFiniteRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

/** Union of two rects; the valid one is returned when the other is null/invalid.
 * Returns null only when both are unusable. */
export function unionRect(a: Rect | null | undefined, b: Rect | null | undefined): Rect | null {
  const av = isFiniteRect(a) ? a : null;
  const bv = isFiniteRect(b) ? b : null;
  if (!av) return bv ? { ...bv } : null;
  if (!bv) return { ...av };
  const x1 = Math.min(av.x, bv.x);
  const y1 = Math.min(av.y, bv.y);
  const x2 = Math.max(av.x + av.width, bv.x + bv.width);
  const y2 = Math.max(av.y + av.height, bv.y + bv.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Union of many rects (null when empty / all invalid). */
export function unionAll(rects: Iterable<Rect>): Rect | null {
  let result: Rect | null = null;
  for (const rect of rects) result = unionRect(result, rect);
  return result;
}

/** True when `p` lies inside (or on the edge of) `r`. Null/degenerate rects
 * contain nothing, so a malformed selection never hits. */
export function rectContainsPoint(r: Rect | null | undefined, p: Point): boolean {
  if (!isFiniteRect(r)) return false;
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** True when two rects overlap (touching edges do not count as overlap). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Normalise a two-corner drag rectangle so width/height are non-negative. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Resize `base` by dragging `handle`, keeping the corner/edge opposite the
 * handle pinned. Produces a non-negative rect; does NOT clamp to min/max (the
 * caller decides). `handle` names the side being dragged: 'nw' moves the
 * top-left and pins the bottom-right, 'e' grows only the right edge, etc.
 */
export function resizeRectFromHandle(base: Rect, handle: HandleId, pointer: Point): Rect {
  const right = base.x + base.width;
  const bottom = base.y + base.height;
  let x = base.x;
  let y = base.y;
  let width = base.width;
  let height = base.height;

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (movesLeft) {
    x = Math.min(pointer.x, right);
    width = right - x;
  } else if (movesRight) {
    const right2 = Math.max(pointer.x, base.x);
    width = right2 - base.x;
  }
  if (movesTop) {
    y = Math.min(pointer.y, bottom);
    height = bottom - y;
  } else if (movesBottom) {
    const bottom2 = Math.max(pointer.y, base.y);
    height = bottom2 - base.y;
  }
  return { x, y, width, height };
}

/**
 * Uniform (equal-ratio) resize: both axes scale by the same factor so the shape
 * never distorts. `corner` is the handle being dragged; when it is null we fall
 * back to a free resize from the bottom-right. The scale factor is the larger of
 * the width / height ratios so a diagonal drag reads as a resize, not a shear.
 */
export function aspectResize(
  base: Rect,
  corner: HandleId | null,
  pointer: Point,
): Rect {
  if (!corner || base.width <= 0 || base.height <= 0) {
    return resizeRectFromHandle(base, corner ?? 'se', pointer);
  }
  const free = resizeRectFromHandle(base, corner, pointer);
  const scaleW = free.width / base.width;
  const scaleH = free.height / base.height;
  let scale = Math.max(scaleW, scaleH);
  if (!Number.isFinite(scale)) scale = 1;
  scale = Math.max(0, scale);
  const width = base.width * scale;
  const height = base.height * scale;
  const right = base.x + base.width;
  const bottom = base.y + base.height;
  let x = base.x;
  let y = base.y;
  if (corner === 'nw' || corner === 'w' || corner === 'sw') x = right - width;
  if (corner === 'nw' || corner === 'n' || corner === 'ne') y = bottom - height;
  return { x, y, width, height };
}

/** Clamp `value` into [min, max]. NaN returns `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** One size limit per object taking part in a resize. */
export interface SizeLimits {
  rect: Rect;
  minSize: number;
  maxSize: number;
}

/**
 * Clamp a desired uniform scale factor so that NO object in the group crosses
 * its own limits. Growing stops at the first object that would exceed
 * `maxSize`; shrinking stops at the first that would fall below `minSize`.
 * Because one factor is returned for the whole group, the relative layout of
 * the selection is preserved by construction (contract `sel.size_limits`).
 *
 * A non-finite or non-positive requested scale leaves the group untouched (1).
 */
export function clampScale(scale: number, limits: Iterable<SizeLimits>): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  let s = scale;
  // Growing: the tightest ceiling wins.
  for (const { rect, maxSize } of limits) {
    if (!isFiniteRect(rect)) continue;
    const ceiling = maxSize / Math.max(rect.width, rect.height);
    if (ceiling < s) s = ceiling;
  }
  // Shrinking: the tightest floor wins (never below the requested scale unless
  // it would break a minimum).
  if (scale < 1) {
    for (const { rect, minSize } of limits) {
      if (!isFiniteRect(rect)) continue;
      const floor = minSize / Math.min(rect.width, rect.height);
      if (floor > s) s = floor;
    }
  }
  return s > 0 ? s : 1;
}

/**
 * Map `child` from the selection's original bounding box `from` into the new
 * box `to`, scaling both its offset and its own size. This is what keeps a
 * cluster's gaps growing with its notes (contract `sel.resize`).
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(from) || !isFiniteRect(child)) return { ...child };
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}