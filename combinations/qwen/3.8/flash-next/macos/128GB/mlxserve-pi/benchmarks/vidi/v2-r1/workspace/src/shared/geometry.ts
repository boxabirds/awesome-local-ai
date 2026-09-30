// Rectangles and the maths done to them, shared by every selection gesture.
//
// Story 7 adds multi-object interaction, and every one of its gestures is the same
// three steps: turn a drag into a rectangle, turn that rectangle into a scale, apply
// the scale to each selected object while keeping the rectangle's anchor still. A
// note, a text block or an image differ only in the parameters they hand in
// (`minSize`, `aspectLocked`), so the maths lives here once instead of in a
// per-object-kind copy.
//
// Like the rest of `src/shared`, this file may not touch the DOM: the persistence
// worker is type-checked against it without DOM library types.
//
// Specs: spec/stories/007-select-move-resize-and-delete-several-objects-at-once/
// design.md, Shared-file layout + `useTransformGesture` (the maths split out).

/** An axis-aligned rectangle in whichever space the caller is working in. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in whichever space the caller is working in. */
export interface Point {
  x: number;
  y: number;
}

/** The eight resize handles, named for the edge(s) they sit on. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Draw order of the handles. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Screen names of the handles, for their accessible labels. */
export const HANDLE_LABELS: Readonly<Record<Handle, string>> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

const finite = (value: number): boolean => Number.isFinite(value);

/** A rectangle with finite, positive size; anything else is not usable. */
export function isUsableRect(rect: Rect): boolean {
  return (
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * True when `inner` lies wholly inside `outer` — edges touching counts as inside.
 * A rectangle with no size (a rectangle the person only clicked, without dragging)
 * contains nothing, not even a note that covers the click.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isUsableRect(outer)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest rectangle that covers all of them; null for none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let box: Rect | null = null;
  for (const rect of rects) {
    if (!isUsableRect(rect)) continue;
    if (!box) {
      box = { ...rect };
      continue;
    }
    const x2 = Math.max(box.x + box.width, rect.x + rect.width);
    const y2 = Math.max(box.y + box.height, rect.y + rect.height);
    box = {
      x: Math.min(box.x, rect.x),
      y: Math.min(box.y, rect.y),
      width: x2 - Math.min(box.x, rect.x),
      height: y2 - Math.min(box.y, rect.y),
    };
  }
  return box;
}

/** Two opposite corners of a drag, in any order, as a proper rectangle. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * The scale factor resizing `start` by `delta` on `handle` asks for, before any
 * minimum or maximum size is applied.
 *
 * With `aspectLocked` the factor is uniform and the axis the drag moved more of
 * decides it, so one gesture cannot make the object wider and shorter at once. The
 * factor is never zero or negative: dragging a handle clean past its anchor stops
 * at a hair of nothing rather than turning the object inside out. Callers that also
 * enforce a minimum size clamp harder than that anyway (`clampScale`).
 */
export function askedResizeScale(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Point {
  if (!isUsableRect(start)) return { x: 1, y: 1 };
  const dx = finite(delta.x) ? delta.x : 0;
  const dy = finite(delta.y) ? delta.y : 0;
  let x = 1;
  let y = 1;
  if (handle.includes('e')) x = (start.width + dx) / start.width;
  if (handle.includes('w')) x = (start.width - dx) / start.width;
  if (handle.includes('s')) y = (start.height + dy) / start.height;
  if (handle.includes('n')) y = (start.height - dy) / start.height;
  if (aspectLocked) {
    const drivesX = handle.includes('e') || handle.includes('w');
    const drivesY = handle.includes('n') || handle.includes('s');
    let uniform = 1;
    if (drivesX && drivesY) {
      // The axis moved further wins; a tie keeps both, which is the same scale.
      uniform = Math.abs(x - 1) >= Math.abs(y - 1) ? x : y;
    } else if (drivesX) {
      uniform = x;
    } else if (drivesY) {
      uniform = y;
    }
    if (!finite(uniform)) uniform = 1;
    x = uniform;
    y = uniform;
  }
  const MIN_SCALE = 1e-6;
  return {
    x: finite(x) ? Math.max(x, MIN_SCALE) : 1,
    y: finite(y) ? Math.max(y, MIN_SCALE) : 1,
  };
}

/**
 * A new rectangle from resizing `start` by `delta` (world units) on `handle`,
 * keeping the starting ratio when `aspectLocked`.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  return scaleRectByFactor(start, handle, askedResizeScale(start, handle, delta, aspectLocked));
}

/**
 * A new rectangle from scaling `start` by `scale` around the anchor implied by
 * `handle`: the opposite edge or corner stays still, and a handle alone on an edge
 * keeps that edge's midpoint still too (so an east handle does not move the note's
 * centre line up or down).
 */
export function scaleRectByFactor(
  start: Rect,
  handle: Handle,
  scale: Point,
): Rect {
  if (!isUsableRect(start)) return { ...start };
  const sx = finite(scale.x) ? Math.max(scale.x, 0) : 1;
  const sy = finite(scale.y) ? Math.max(scale.y, 0) : 1;
  const width = start.width * sx;
  const height = start.height * sy;
  let x = start.x;
  let y = start.y;
  if (handle.includes('w')) x = start.x + start.width - width;
  else if (handle === 'n' || handle === 's') x = start.x + (start.width - width) / 2;
  if (handle.includes('n')) y = start.y + start.height - height;
  else if (handle === 'e' || handle === 'w') y = start.y + (start.height - height) / 2;
  return { x, y, width, height };
}

/**
 * Clamp a scale factor so no rectangle in `rects` leaves its minimum size or the
 * maximum size, with `minSizes[i]` the minimum for `rects[i]` (a missing or
 * unusable entry means "no minimum").
 *
 * When `scale.x` and `scale.y` are equal the scale is *uniform* and stays uniform:
 * clamping then takes the tightest bound across both axes, which is what keeps a
 * uniform gesture uniform instead of letting one axis stop at a minimum and the
 * other carry on. A non-uniform scale is clamped per axis, and an axis whose bounds
 * contradict each other (a rectangle already outside them) does not move at all.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  if (!finite(scale.x) || !finite(scale.y)) return { x: 1, y: 1 };
  const cap = finite(maxSize) && maxSize > 0 ? maxSize : Infinity;
  let loX = 0;
  let loY = 0;
  let hiX = Infinity;
  let hiY = Infinity;
  rects.forEach((rect, index) => {
    if (!isUsableRect(rect)) return;
    const min = minSizes[index] ?? 0;
    if (!finite(min) || min < 0) return;
    loX = Math.max(loX, min / rect.width);
    loY = Math.max(loY, min / rect.height);
    hiX = Math.min(hiX, cap / rect.width);
    hiY = Math.min(hiY, cap / rect.height);
  });
  if (scale.x === scale.y) {
    const lo = Math.max(loX, loY);
    const hi = Math.min(hiX, hiY);
    const value = hi >= lo ? Math.min(Math.max(scale.x, lo), hi) : 1;
    return { x: value, y: value };
  }
  return {
    x: hiX >= loX ? Math.min(Math.max(scale.x, loX), hiX) : 1,
    y: hiY >= loY ? Math.min(Math.max(scale.y, loY), hiY) : 1,
  };
}

/**
 * Where `child` ends up when the rectangle it lives in goes from `from` to `to`:
 * position and size scaled by the same factors, relative to `from`'s corner. This
 * is how a selection of several objects is resized as one — each object keeps its
 * place inside the selection's bounding box.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isUsableRect(child) || !isUsableRect(from) || !isUsableRect(to)) {
    return { ...child };
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

/**
 * Where a handle sits on a rectangle: the corner or edge midpoint it is named
 * for. The selection overlay places its handles from this, so the handle a
 * person grabs and the edge that moves are always the same one.
 */
export function handlePosition(rect: Rect, handle: Handle): Point {
  const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
  const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x, y };
}

/**
 * A rectangle grown or shrunk about its own centre by `scale` — a uniform scale
 * keeps the centre still, which is what makes it a ratio-preserving change of size.
 */
export function scaleAboutCenter(rect: Rect, scale: Point): Rect {
  if (!isUsableRect(rect)) return { ...rect };
  const sx = finite(scale.x) && scale.x > 0 ? scale.x : 1;
  const sy = finite(scale.y) && scale.y > 0 ? scale.y : 1;
  return {
    x: rect.x + (rect.width - rect.width * sx) / 2,
    y: rect.y + (rect.height - rect.height * sy) / 2,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}
