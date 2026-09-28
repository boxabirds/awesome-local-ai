// Pure rectangle geometry for multi-select, marquee and group resize (story 7).
// All coordinates are world (board) units unless a name says "screen".
// Everything here is total: invalid input never throws, it produces no usable
// result (null / non-finite) so callers can refuse the write.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// The eight resize handles of a bounding box: four corners, four edges.
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

// The accessible position name of each handle (e.g. "Resize top-left").
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isFiniteRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r && num(r.x) && num(r.y) && num(r.width) && num(r.height) && r.width > 0 && r.height > 0
  );
}

// A rect contains another only when the inner rect lies ENTIRELY within it
// (edges included). The marquee rule: an object touched but not enclosed is
// not selected (TC-07).
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isFiniteRect(outer) || !isFiniteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// The smallest rect bounding all of them; null when there is nothing to bound
// or any input is unusable (never a NaN box).
export function unionRects(rects: Rect[]): Rect | null {
  if (!rects || rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!isFiniteRect(r)) return null;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// The rectangle with two (possibly out-of-order) corner points; used by the
// marquee so a drag in any direction yields a positive rect in world units.
export function normalizeRect(a: Point, b: Point): Rect {
  if (!a || !b || !num(a.x) || !num(a.y) || !num(b.x) || !num(b.y)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

// The new rect when `start` is resized by dragging `handle` by `delta`
// (world-unit pointer delta). Edge handles change one axis, corners both; the
// opposite corner/edge is the anchor. With `aspectLocked` the start's
// width:height ratio is preserved (the dominant axis drives the scale).
// Shrinking stops at an epsilon positive size; a flip is never produced.
// Non-finite input yields a non-finite rect: callers must check before writing.
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  const nan: Rect = { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN };
  if (
    !isFiniteRect(start) ||
    !delta ||
    !num(delta.x) ||
    !num(delta.y) ||
    !HANDLES.includes(handle)
  ) {
    return nan;
  }
  const growsX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const growsY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const dw = growsX !== 0 ? growsX * delta.x : 0;
  const dh = growsY !== 0 ? growsY * delta.y : 0;

  let width: number;
  let height: number;
  if (aspectLocked) {
    // The axis the pointer moved more along (relative to the side it drags)
    // drives the uniform scale; the other axis follows so the ratio is kept.
    let scale: number;
    if (growsX !== 0 && growsY !== 0) {
      const relW = dw / start.width;
      const relH = dh / start.height;
      scale =
        Math.abs(relW) >= Math.abs(relH)
          ? (start.width + dw) / start.width
          : (start.height + dh) / start.height;
    } else if (growsX !== 0) {
      scale = (start.width + dw) / start.width;
    } else {
      scale = (start.height + dh) / start.height;
    }
    if (!num(scale)) return nan;
    width = start.width * scale;
    height = start.height * scale;
  } else {
    width = start.width + dw;
    height = start.height + dh;
  }
  if (!num(width) || !num(height)) return nan;
  // Never flip or vanish: stop just short of zero instead.
  const EPS = 1e-6;
  width = Math.max(EPS, width);
  height = Math.max(EPS, height);

  // Re-anchor: the edge/corner opposite the handle does not move; an
  // aspect-coupled cross axis grows away from the anchored corner too.
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const x = growsX < 0 ? right - width : start.x;
  const y = growsY > 0 ? start.y : growsY < 0 ? bottom - height : start.y;
  return { x, y, width, height };
}

// Clamp a requested bounding-box scale so no object crosses its own minimum
// size or the global maximum. The allowed interval is intersected per axis; a
// uniformly-requested scale (aspect-locked resize) is clamped to the
// intersection of BOTH axes so it stays uniform. Non-finite input passes
// through unchanged so the gesture can refuse the frame.
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (!scale || !num(scale.x) || !num(scale.y)) return { x: scale?.x ?? Number.NaN, y: scale?.y ?? Number.NaN };
  if (!rects || rects.length === 0) return { x: scale.x, y: scale.y };
  let loX = 0;
  let loY = 0;
  let hiX = Infinity;
  let hiY = Infinity;
  rects.forEach((r, i) => {
    if (!isFiniteRect(r)) return;
    const min = num(minSizes[i]) ? Math.max(0, minSizes[i]) : 0;
    loX = Math.max(loX, min / r.width);
    loY = Math.max(loY, min / r.height);
    if (num(maxSize) && maxSize > 0) {
      hiX = Math.min(hiX, maxSize / r.width);
      hiY = Math.min(hiY, maxSize / r.height);
    }
  });
  const uniform = scale.x === scale.y;
  if (uniform) {
    const lo = Math.max(loX, loY);
    const hi = Math.min(hiX, hiY);
    const s = Math.min(Math.max(scale.x, lo), hi);
    return { x: s, y: s };
  }
  return {
    x: Math.min(Math.max(scale.x, loX), hiX),
    y: Math.min(Math.max(scale.y, loY), hiY),
  };
}

// Map a child rect from the `from` box into the `to` box: its size and its
// offset from the box corner scale by the box's scale factors, so sizes AND
// gaps scale together (TC-04). A degenerate source box returns the child
// unchanged; a non-finite result is left non-finite for the caller to reject.
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isFiniteRect(child) || !isFiniteRect(from) || !isFiniteRect(to)) return child;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
