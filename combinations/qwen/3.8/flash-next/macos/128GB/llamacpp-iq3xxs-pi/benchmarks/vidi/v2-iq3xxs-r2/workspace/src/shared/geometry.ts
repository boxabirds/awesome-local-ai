/**
 * The pure rectangle maths story 7 builds on: containment for marquee selection, the
 * bounding box of a selection, and the resize arithmetic a bounding box does to itself
 * and to every object inside it. World units throughout — no camera, no DOM, no Yjs.
 *
 * Kept out of `board-model` on purpose (design: "No new code in `board-model.ts` may
 * special-case sticky notes"): these functions know only rectangles, which is exactly
 * what makes a resize behave the same for a sticky note, a shape (story 10) or an image
 * (story 12).
 */

/** A box in board units; `x`, `y` is its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in board units. */
export interface Point {
  x: number;
  y: number;
}

/** The eight resize handles of a bounding box, named for the edge(s) they sit on. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** Every handle, in the order the selection overlay renders them. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Accessible names, spelled out so a screen reader never has to read a compass letter
 * (PRD: handles have accessible names, e.g. "Resize top-left").
 */
export const HANDLE_LABELS: Record<Handle, string> = {
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
  nw: 'Resize top-left',
};

export function handleLabel(handle: Handle): string {
  return HANDLE_LABELS[handle];
}

function finite(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRect(rect: Rect | undefined): boolean {
  return (
    !!rect &&
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

function isPoint(point: Point | undefined): boolean {
  return !!point && finite(point.x) && finite(point.y);
}

/**
 * True when `inner` lies entirely within `outer`. The marquee rule (PRD): "An object is
 * selected when its bounding box is entirely within the marquee rectangle." Edges that
 * line up exactly count as inside — nothing sticks out — while an object that only
 * touches the marquee from outside does not.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isRect(outer) || !isRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest box holding every rectangle, or null when there is nothing to hold — an
 * empty selection has no bounding box, and inventing one at the origin would draw handles
 * in the middle of the board. Rectangles nobody can draw are skipped.
 */
export function unionRects(rects: Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const rect of rects) {
    if (!isRect(rect)) continue;
    any = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The box between two dragged corners, whichever way the drag went. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!isPoint(a) || !isPoint(b)) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * A box of the given size, held where `handle` is not: a handle on the right edge keeps
 * the left edge still, a handle on the left keeps the right, a handle on top keeps the
 * bottom, and an edge handle keeps the *other* axis centred, which is what a drag from
 * that edge feels like.
 */
export function anchoredRect(start: Rect, handle: Handle, width: number, height: number): Rect {
  const east = start.x + start.width;
  const south = start.y + start.height;
  let x = start.x;
  let y = start.y;
  if (handle.includes('w')) x = east - width;
  else if (handle.includes('e')) x = start.x;
  else x = start.x + (start.width - width) / 2; // a north/south handle centres horizontally
  if (handle.includes('n')) y = south - height;
  else if (handle.includes('s')) y = start.y;
  else y = start.y + (start.height - height) / 2; // an east/west handle centres vertically
  return { x, y, width, height };
}

/**
 * Drag one handle of a box by `delta` (board units) and return the box that results.
 *
 * With `aspectLocked` (a sticky note, an image with its ratio) the axis the pointer moved
 * further along decides the scale and the other axis follows, so a 200x200 note dragged
 * 100 across and 40 down becomes 300x300, never 300x240. The anchor is the corner the
 * handle is not on, so the box never turns inside out: an axis stops at zero.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  if (!isRect(start) || !isPoint(delta)) return { ...start };

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left += delta.x;
  if (handle.includes('e')) right += delta.x;
  if (handle.includes('n')) top += delta.y;
  if (handle.includes('s')) bottom += delta.y;
  // A handle dragged past its opposite corner stops there instead of flipping the box.
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (!aspectLocked) return anchoredRect(start, handle, width, height);

  // An edge handle only ever moves one axis, so that axis decides the scale — otherwise a
  // sticky note's left handle could never shrink it, the axis the pointer never moved being
  // the one that set the ratio.
  if (handle.length === 1) {
    const oneAxis = handle === 'e' || handle === 'w' ? width / start.width : height / start.height;
    const scale = Number.isFinite(oneAxis) && oneAxis > 0 ? oneAxis : 1;
    return anchoredRect(start, handle, start.width * scale, start.height * scale);
  }

  // A corner: the dominant axis is the one the pointer moved further along.
  const scaleX = start.width > 0 ? width / start.width : 1;
  const scaleY = start.height > 0 ? height / start.height : 1;
  const scale = Math.max(scaleX, scaleY);
  return anchoredRect(
    start,
    handle,
    Math.max(0, start.width * scale),
    Math.max(0, start.height * scale),
  );
}

function positiveSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The largest scale that keeps every object inside its own minimum (`minSizes[i]` belongs
 * to `rects[i]`) and inside the single global maximum, applied to the whole selection at
 * once — PRD sel.size_limits: "stop the whole selection at the scale where the first
 * object reaches it", never resize past a limit object by object.
 *
 * Each axis gets its own limit, because that is the object that reaches it: an edge handle
 * (an object type without proportions, TC-24) proposes a change on one axis and `1` on the
 * other, and the axis nobody is dragging must be left exactly alone. A corner handle of an
 * aspect-locked selection proposes the same number twice, and the caller keeps it that way
 * so a group resize never distorts anything.
 *
 * A scale that is not a real number becomes 1, which changes nothing.
 */
export function clampScale(
  scale: Point,
  rects: Rect[],
  minSizes: number[],
  maxSize: number,
): Point {
  if (!isPoint(scale)) return { x: 1, y: 1 };
  let floorX = 0;
  let floorY = 0;
  let ceilingX = Number.POSITIVE_INFINITY;
  let ceilingY = Number.POSITIVE_INFINITY;
  rects.forEach((rect, index) => {
    if (!isRect(rect)) return;
    const smallest = positiveSize(minSizes[index]);
    if (rect.width > 0) {
      if (smallest > 0) floorX = Math.max(floorX, smallest / rect.width);
      if (finite(maxSize)) ceilingX = Math.min(ceilingX, maxSize / rect.width);
    }
    if (rect.height > 0) {
      if (smallest > 0) floorY = Math.max(floorY, smallest / rect.height);
      if (finite(maxSize)) ceilingY = Math.min(ceilingY, maxSize / rect.height);
    }
  });
  // An object already bigger than the maximum, or smaller than its minimum: the limit it
  // cannot leave is the one it is at, so the axis simply stops moving.
  if (!(ceilingX >= floorX)) ceilingX = floorX;
  if (!(ceilingY >= floorY)) ceilingY = floorY;
  const clampAxis = (proposed: number, floor: number, ceiling: number): number =>
    Math.min(Math.max(proposed, floor), ceiling);
  return {
    x: clampAxis(scale.x, floorX, ceilingX),
    y: clampAxis(scale.y, floorY, ceilingY),
  };
}

/**
 * Where an object ends up when the box around it moves from `from` to `to`: its position
 * relative to the box scales, so the gap between two objects grows in step with the
 * objects themselves (PRD: two notes 100 units apart are 200 apart once the box doubled).
 *
 * `to` normally comes from a resize of the *selection's* bounding box, which is why the
 * box height is allowed to differ from the object's own height ratio: every object scales
 * by the box's factors, so nothing shifts relative to anything else.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isRect(child) || !isRect(from) || !isRect(to)) return { ...child };
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * scaleX,
    y: to.y + (child.y - from.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}
