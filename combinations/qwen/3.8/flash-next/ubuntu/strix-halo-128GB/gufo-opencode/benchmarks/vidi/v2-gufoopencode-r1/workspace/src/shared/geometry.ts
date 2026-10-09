// Pure world-unit geometry shared by the model, the transform gesture and the
// selection overlay. No DOM, no Yjs.

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

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

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

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

// Target rect for dragging `handle` of `start` by a world delta. Dimensions may
// come out below the minimums (or negative); clampScale is the step that
// enforces the size limits. With aspectLocked the dominant axis drives a
// uniform scale (corners), or the affected axis does (edges).
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');
  const dx = handle.includes('e') ? delta.x : handle.includes('w') ? -delta.x : 0;
  const dy = handle.includes('s') ? delta.y : handle.includes('n') ? -delta.y : 0;
  let sx = start.width === 0 ? 1 : (start.width + dx) / start.width;
  let sy = start.height === 0 ? 1 : (start.height + dy) / start.height;
  if (aspectLocked) {
    const uniform =
      affectsX && affectsY
        ? Math.abs(sx - 1) >= Math.abs(sy - 1)
          ? sx
          : sy
        : affectsX
          ? sx
          : sy;
    sx = uniform;
    sy = uniform;
  }
  const width = start.width * sx;
  const height = start.height * sy;
  return {
    x: handle.includes('w') ? start.x + start.width - width : start.x,
    y: handle.includes('n') ? start.y + start.height - height : start.y,
    width,
    height
  };
}

// The single scale at which no rect crosses its minimum size or the global
// maximum. Uniform input (sx === sy, from an aspect-locked resizeRect) clamps a
// single factor against the tightest bound of every rect, so the whole
// selection stops as soon as the first object reaches a limit.
export function clampScale(scale: Point, rects: Rect[], minSizes: number[], maxSize: number): Point {
  if (rects.length === 0) return scale;
  const uniform = scale.x === scale.y;
  let sx = scale.x;
  let sy = scale.y;
  if (uniform) {
    let lo = -Infinity;
    let hi = Infinity;
    rects.forEach((r, i) => {
      const min = minSizes[i] ?? 0;
      lo = Math.max(lo, min / r.width, min / r.height);
      hi = Math.min(hi, maxSize / r.width, maxSize / r.height);
    });
    const s = Math.min(Math.max(sx, lo), hi);
    return { x: s, y: s };
  }
  let loX = -Infinity;
  let hiX = Infinity;
  let loY = -Infinity;
  let hiY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    loX = Math.max(loX, min / r.width);
    hiX = Math.min(hiX, maxSize / r.width);
    loY = Math.max(loY, min / r.height);
    hiY = Math.min(hiY, maxSize / r.height);
  });
  sx = Math.min(Math.max(sx, loX), hiX);
  sy = Math.min(Math.max(sy, loY), hiY);
  return { x: sx, y: sy };
}

// Map `child` from being inside `from` to being inside `to`, preserving its
// relative position and scaling its size: positions and gaps scale together.
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy
  };
}
