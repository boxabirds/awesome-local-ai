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

// True only when all four edges of `inner` lie within `outer` (touching the
// border from inside counts; poking outside does not).
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
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  };
}

// Drag a handle by `delta` (world units). Edge handles change one axis,
// corners both. With aspectLocked the ratio is kept using the dominant axis
// ratio, anchored at the opposite corner or edge (centre on the other axis).
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  if (!aspectLocked) {
    let { x, y, width, height } = start;
    if (west) {
      x += delta.x;
      width -= delta.x;
    } else if (east) {
      width += delta.x;
    }
    if (north) {
      y += delta.y;
      height -= delta.y;
    } else if (south) {
      height += delta.y;
    }
    return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
  }

  const ratios: number[] = [];
  if (west || east) {
    const width = west ? start.width - delta.x : start.width + delta.x;
    ratios.push(start.width > 0 ? width / start.width : 1);
  }
  if (north || south) {
    const height = north ? start.height - delta.y : start.height + delta.y;
    ratios.push(start.height > 0 ? height / start.height : 1);
  }
  const s = Math.max(0, ...ratios);
  const width = start.width * s;
  const height = start.height * s;
  let x: number;
  if (west) x = start.x + start.width - width;
  else if (east) x = start.x;
  else x = start.x + (start.width - width) / 2;
  let y: number;
  if (north) y = start.y + start.height - height;
  else if (south) y = start.y;
  else y = start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

// The single scale (uniform when scaleX === scaleY, otherwise per-axis) at
// which no rect in `rects` is smaller than its type's minSize or larger than
// maxSize. The result stops the whole selection the moment the first object
// reaches a limit.
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number
): Point {
  if (rects.length === 0) return { x: scale.x, y: scale.y };
  let lowerX = 0;
  let upperX = Infinity;
  let lowerY = 0;
  let upperY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    if (r.width > 0) {
      lowerX = Math.max(lowerX, min / r.width);
      upperX = Math.min(upperX, maxSize / r.width);
    }
    if (r.height > 0) {
      lowerY = Math.max(lowerY, min / r.height);
      upperY = Math.min(upperY, maxSize / r.height);
    }
  });
  const clampAxis = (v: number, lower: number, upper: number): number =>
    Math.min(Math.max(v, lower), Math.max(lower, upper));
  if (scale.x === scale.y) {
    const s = clampAxis(scale.x, Math.max(lowerX, lowerY), Math.min(upperX, upperY));
    return { x: s, y: s };
  }
  return { x: clampAxis(scale.x, lowerX, upperX), y: clampAxis(scale.y, lowerY, upperY) };
}

// Reposition and scale `child` from being laid out in `from` to `to`, so the
// relative layout of a group is preserved under a bounding-box resize.
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy
  };
}
