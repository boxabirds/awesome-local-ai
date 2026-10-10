// Pure rectangle/point maths for selection, marquee and transform gestures.
// Framework-free and free of board-model imports so both the client and the
// shared model layer can rely on it.

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

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

// True only when all four edges of `inner` lie inside `outer`. An object that
// is only partly inside, or merely touches the edge from outside, is false.
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// Axis-aligned bounding box of a non-empty list; null for an empty list.
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

// Rectangle spanned by two opposite corners, in either drag direction.
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function handleMove(handle: Handle): { mx: number; my: number } {
  return {
    mx: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
    my: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
  };
}

// Free resize of `start` by dragging `handle` by `delta` (world units). The
// opposite edge or corner is anchored; edge handles keep the unaffected axis
// centred. With `aspectLocked` the dominant axis decides the uniform factor.
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const { mx, my } = handleMove(handle);
  let w = Math.max(0, start.width + mx * delta.x);
  let h = Math.max(0, start.height + my * delta.y);
  if (aspectLocked) {
    const sx = start.width > 0 ? w / start.width : 1;
    const sy = start.height > 0 ? h / start.height : 1;
    const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    w = start.width * s;
    h = start.height * s;
  }
  const x = mx > 0 ? start.x : mx < 0 ? start.x + (start.width - w) : start.x + (start.width - w) / 2;
  const y = my > 0 ? start.y : my < 0 ? start.y + (start.height - h) : start.y + (start.height - h) / 2;
  return { x, y, width: w, height: h };
}

// Single scale, closest to the requested one, at which no rect crosses its
// type's minimum or the global maximum. The same factor is applied to both
// axes, so the whole selection stops as soon as the first object reaches a
// limit and the relative layout is preserved.
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (rects.length === 0) return scale;
  let sxLo = 0;
  let sxHi = Infinity;
  let syLo = 0;
  let syHi = Infinity;
  for (const [i, r] of rects.entries()) {
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      sxLo = Math.max(sxLo, min / r.width);
      sxHi = Math.min(sxHi, maxSize / r.width);
    } else {
      sxLo = Math.max(sxLo, Infinity);
    }
    if (r.height > 0) {
      syLo = Math.max(syLo, min / r.height);
      syHi = Math.min(syHi, maxSize / r.height);
    } else {
      syLo = Math.max(syLo, Infinity);
    }
  }
  // Degenerate requested axis: pin it at its minimum instead of collapsing.
  if (!(scale.x > 0)) return { x: Number.isFinite(sxLo) ? sxLo : scale.x, y: Number.isFinite(syLo) ? syLo : scale.y };
  if (!(scale.y > 0)) return { x: Number.isFinite(sxLo) ? sxLo : scale.x, y: Number.isFinite(syLo) ? syLo : scale.y };
  // Feasible parameter t for (sx, sy) = t * requested, t closest to 1.
  let tLo = Math.max(sxLo / scale.x, syLo / scale.y);
  let tHi = Math.min(sxHi / scale.x, syHi / scale.y);
  if (tLo > tHi) {
    // Empty feasible interval (degenerate sizes): clamp each axis on its own.
    return {
      x: Math.min(Math.max(scale.x, sxLo), sxHi),
      y: Math.min(Math.max(scale.y, syLo), syHi),
    };
  }
  const t = Math.min(Math.max(tLo, 1), tHi);
  return { x: scale.x * t, y: scale.y * t };
}

// Remap `child` from inside `from` to inside `to` with per-axis proportional
// scaling of both position (relative to `from`) and size.
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
