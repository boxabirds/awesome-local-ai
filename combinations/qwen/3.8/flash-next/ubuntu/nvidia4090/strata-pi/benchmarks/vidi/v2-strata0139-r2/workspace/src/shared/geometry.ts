/**
 * Board geometry (story 7).
 *
 * Everything that decides *where* an object ends up when a person selects,
 * box-selects, moves or resizes a group of objects. Pure functions over world
 * (board) units — no Y.Doc, no DOM — so the same maths that a pointer gesture
 * uses is testable on its own and is shared by the client and, through
 * `board-model`, by anything that later replays board content.
 *
 * The board's size limits are applied here in one place (`clampScale`): a group
 * resize picks a single scale for the whole selection, so the selection stops
 * as soon as its first object reaches a limit instead of distorting.
 */

/** A point in world units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box in world units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The eight bounding-box handles: four corners and four edges. */
export type Handle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** Every handle, in clockwise order from the top-left corner. */
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Accessible position names: `aria-label="Resize top-left"`. */
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: "top-left",
  n: "top",
  ne: "top-right",
  e: "right",
  se: "bottom-right",
  s: "bottom",
  sw: "bottom-left",
  w: "left",
};

/** Tolerance for "exactly on the edge counts as inside". */
const EPSILON = 1e-9;

/** True only when all four edges of `inner` lie inside `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!isRect(outer) || !isRect(inner)) return false;
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

/** The smallest box covering every usable rect; `null` when there is none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    if (!isRect(rect)) continue;
    if (rect.x < minX) minX = rect.x;
    if (rect.y < minY) minY = rect.y;
    if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
    if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
  }

  if (minX === Number.POSITIVE_INFINITY || maxX === Number.NEGATIVE_INFINITY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Two drag corners, in any order, as a positive rect. */
export function normalizeRect(a: Point, b: Point): Rect {
  if (!isPoint(a) || !isPoint(b)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * The box a handle drag produces, anchored on the opposite corner or edge.
 *
 * A corner handle changes both axes, an edge handle one axis; with
 * `aspectLocked` the whole box is scaled by one factor instead, so its
 * width-to-height ratio is unchanged (sticky notes always resize this way,
 * and Shift requests it for any type).
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!isRect(start)) return { x: 0, y: 0, width: 0, height: 0 };
  const dx = isFiniteNumber(delta?.x) ? delta.x : 0;
  const dy = isFiniteNumber(delta?.y) ? delta.y : 0;
  const scale = scaleForDrag(start, handle, dx, dy, aspectLocked);
  return boxForScale(start, handle, scale, aspectLocked);
}

/**
 * The single scale a group resize may apply.
 *
 * Every rect is measured against its own type's minimum and against one global
 * maximum; the returned scale is the largest (or smallest) one at which *no*
 * object crosses either limit. When the requested scale is uniform the result
 * is uniform, so a group stops together at the first limit it hits.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  if (!isFiniteNumber(scale?.x) || !isFiniteNumber(scale?.y)) return { x: 1, y: 1 };
  if (scale.x < 0 || scale.y < 0) return { x: 1, y: 1 };

  const uniform = scale.x === scale.y;
  let loX = 0;
  let hiX = Number.POSITIVE_INFINITY;
  let loY = 0;
  let hiY = Number.POSITIVE_INFINITY;

  rects.forEach((rect, index) => {
    if (!isRect(rect)) return;
    const min = isFiniteNumber(minSizes[index]) && minSizes[index] > 0 ? minSizes[index] : 0;
    const max = isFiniteNumber(maxSize) && maxSize > 0 ? maxSize : Number.POSITIVE_INFINITY;

    if (rect.width > 0) {
      loX = Math.max(loX, min / rect.width);
      hiX = Math.min(hiX, max / rect.width);
    }
    if (rect.height > 0) {
      loY = Math.max(loY, min / rect.height);
      hiY = Math.min(hiY, max / rect.height);
    }
  });

  if (uniform) {
    const lo = Math.max(loX, loY);
    let hi = Math.min(hiX, hiY);
    // A minimum and a maximum that cannot both be honoured: the minimum wins.
    if (hi < lo) hi = lo;
    const value = clamp(scale.x, lo, hi);
    return { x: value, y: value };
  }

  return {
    x: clamp(scale.x, loX, Math.max(loX, hiX)),
    y: clamp(scale.y, loY, Math.max(loY, hiY)),
  };
}

/**
 * Where `child` lands when the box it belongs to moves from `from` to `to`:
 * positions and sizes scale by the box's own change, which is what keeps a
 * group's layout intact while it is resized.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!isRect(child) || !isRect(from) || !isRect(to)) return child;
  if (from.width <= 0 || from.height <= 0) return child;

  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (!isFiniteNumber(sx) || !isFiniteNumber(sy)) return child;

  const result: Rect = {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
  return isRect(result) ? result : child;
}

/** The scale that turns `from` into `to` (used to feed `clampScale`). */
export function scaleBetween(from: Rect, to: Rect): Point {
  if (!isRect(from) || !isRect(to) || from.width <= 0 || from.height <= 0) return { x: 1, y: 1 };
  const x = to.width / from.width;
  const y = to.height / from.height;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || x < 0 || y < 0) return { x: 1, y: 1 };
  return { x, y };
}

/** The box `start` would have after being scaled by `scale` around its handle anchor. */
export function boxForScale(start: Rect, handle: Handle, scale: Point, aspectLocked: boolean): Rect {
  if (!isRect(start)) return { x: 0, y: 0, width: 0, height: 0 };
  const edges = handleEdges(handle);
  const width = Math.max(0, start.width * (isFiniteNumber(scale?.x) ? scale.x : 1));
  const height = Math.max(0, start.height * (isFiniteNumber(scale?.y) ? scale.y : 1));

  let x = edges.west ? start.x + start.width - width : start.x;
  let y = edges.north ? start.y + start.height - height : start.y;

  // An edge handle with a locked ratio also grows the axis it does not drag;
  // that growth is centred, so the dragged edge keeps its midpoint.
  if (aspectLocked) {
    if (!edges.west && !edges.east) x = start.x + (start.width - width) / 2;
    if (!edges.north && !edges.south) y = start.y + (start.height - height) / 2;
  }

  return { x, y, width, height };
}

// ---- internals ------------------------------------------------------------

function scaleForDrag(start: Rect, handle: Handle, dx: number, dy: number, aspectLocked: boolean): Point {
  const edges = handleEdges(handle);
  const widthAfter = edges.west ? start.width - dx : edges.east ? start.width + dx : start.width;
  const heightAfter = edges.north ? start.height - dy : edges.south ? start.height + dy : start.height;

  const sx = start.width > 0 ? Math.max(0, widthAfter / start.width) : 1;
  const sy = start.height > 0 ? Math.max(0, heightAfter / start.height) : 1;

  if (!aspectLocked) return { x: sx, y: sy };

  // Which axis the pointer moved along drives the whole box.
  const dominant = edges.west || edges.east ? (Math.abs(dx) >= Math.abs(dy) ? sx : sy) : sy;
  return { x: dominant, y: dominant };
}

function handleEdges(handle: Handle): { west: boolean; east: boolean; north: boolean; south: boolean } {
  return {
    west: handle === "w" || handle === "nw" || handle === "sw",
    east: handle === "e" || handle === "ne" || handle === "se",
    north: handle === "n" || handle === "nw" || handle === "ne",
    south: handle === "s" || handle === "sw" || handle === "se",
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return !!value && isFiniteNumber((value as Point).x) && isFiniteNumber((value as Point).y);
}

function isRect(value: unknown): value is Rect {
  const rect = value as Rect | undefined;
  return (
    !!rect &&
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
