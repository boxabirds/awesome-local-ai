/**
 * Pure geometry for multi-object selection, group moves and bounding-box
 * resizes (story 7).
 *
 * All values are in world units; nothing here knows about the camera or the
 * DOM. The gesture code (sel.transform) composes these primitives:
 * `resizeRect` for the pointer-driven box, `clampScale` against each type's
 * limits, `scaleWithin` per object.
 */

/** A rectangle in world coordinates: top-left corner + positive size. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in world coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** The eight resize handles around a bounding box. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const HANDLES: readonly Handle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/**
 * True when `inner` lies fully inside `outer` (edges inclusive). Used by
 * marquee selection: an object that is only partly inside, or crosses an
 * edge, is not selected.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Union of several rectangles, or null when there are none (or none with a
 * positive area). Used for the selection bounding box.
 */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!(r.width > 0) || !(r.height > 0)) {
      continue;
    }
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Normalized rectangle spanned by two points (drag start, current), in any
 * drag direction. Stored in world units so zoom changes mid-drag are
 * harmless.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Smallest positive size resizeRect will produce (clamping is clampScale's job). */
const EPSILON = 1e-6;

function clampApplied(delta: number, extent: number): number {
  const max = extent - EPSILON;
  return Math.min(Math.max(delta, -max), max);
}

/**
 * Resize `start` by dragging `handle` by `delta`.
 *
 * - Edge handles change one axis; corner handles both.
 * - Dragging an edge past the opposite edge clamps at a minimal positive
 *   size (object size limits are enforced separately by `clampScale`).
 * - With `aspectLocked`, the result keeps `start`'s width:height ratio
 *   anchored at the opposite corner (corners) or opposite edge (edges:
 *   horizontal handles anchor the top edge, vertical handles the left edge).
 *   For corners the scale comes from the axis the pointer moved most, so a
 *   2:1 object stays 2:1 in both directions.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  delta: Point,
  aspectLocked: boolean,
): Rect {
  const { x: x0, y: y0, width: w0, height: h0 } = start;
  let x = x0;
  let y = y0;
  let width = w0;
  let height = h0;

  const isN = handle === 'n' || handle === 'nw' || handle === 'ne';
  const isS = handle === 's' || handle === 'se' || handle === 'sw';
  const isW = handle === 'w' || handle === 'nw' || handle === 'sw';
  const isE = handle === 'e' || handle === 'se' || handle === 'ne';
  const corner = isN !== isS && isW !== isE;

  // First pass: move the handle's edge(s) directly.
  if (isW) {
    const applied = clampApplied(delta.x, w0);
    x = x0 + applied;
    width = w0 - applied;
  } else if (isE) {
    width = Math.max(w0 + delta.x, EPSILON);
  }
  if (isN) {
    const applied = clampApplied(delta.y, h0);
    y = y0 + applied;
    height = h0 - applied;
  } else if (isS) {
    height = Math.max(h0 + delta.y, EPSILON);
  }

  if (aspectLocked) {
    const ratio = h0 / w0;
    if (corner) {
      const sx = width / w0;
      const sy = height / h0;
      // The axis the pointer moved most leads; the other follows.
      const scale = Math.abs(delta.x) >= Math.abs(delta.y) ? sx : sy;
      width = Math.max(w0 * scale, EPSILON);
      height = Math.max(width * ratio, EPSILON);
      if (isW) {
        x = x0 + w0 - width; // right edge stays put
      }
      if (isN) {
        y = y0 + h0 - height; // bottom edge stays put
      }
    } else if (isE || isW) {
      // Horizontal edge: width leads, height follows, top edge fixed.
      height = width * ratio;
      if (isW) {
        x = x0 + w0 - width;
      }
    } else {
      // Vertical edge: height leads, width follows, left edge fixed.
      width = height / ratio;
      if (isN) {
        y = y0 + h0 - height;
      }
    }
  }

  return { x, y, width, height };
}

/**
 * Map a child rect from bounding box `from` to `to` (each axis scaled by the
 * box scale and translated). Used to place every selected object after a
 * bounding-box resize.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}

/**
 * Clamp a bounding-box scale so no object crosses its limits: every rect in
 * `rects` scaled about the box origin stays at least `minSizes[i]` (per
 * object) and at most `maxSize` on each axis.
 *
 * Each axis is clamped independently, which is equivalent to a single
 * uniform clamp whenever the incoming scale is uniform (aspect-locked
 * selections). The selection therefore stops as soon as the first object
 * reaches a limit on that axis.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  let minX = 0;
  let maxX = Infinity;
  let minY = 0;
  let maxY = Infinity;
  rects.forEach((r, i) => {
    const min = minSizes[i] ?? 0;
    if (!(r.width > 0) || !(r.height > 0) || !(maxSize > 0)) {
      return;
    }
    maxX = Math.min(maxX, maxSize / r.width);
    maxY = Math.min(maxY, maxSize / r.height);
    if (min > 0) {
      minX = Math.max(minX, min / r.width);
      minY = Math.max(minY, min / r.height);
    }
  });
  const clampAxis = (s: number, lo: number, hi: number): number => {
    if (!Number.isFinite(s)) {
      return 1; // identity: the gesture rejects non-finite boxes upstream
    }
    if (hi < lo) {
      return hi; // contradictory limits: the max bound wins
    }
    return s < lo ? lo : s > hi ? hi : s;
  };
  return { x: clampAxis(scale.x, minX, maxX), y: clampAxis(scale.y, minY, maxY) };
}
