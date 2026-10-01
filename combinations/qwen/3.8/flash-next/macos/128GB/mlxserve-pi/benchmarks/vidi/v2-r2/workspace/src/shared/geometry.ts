// Selection geometry: the rectangle maths behind marquee, bounding box,
// group resize and clamping. Framework-free and DOM-free, like everything in
// src/shared: every function here is pure, so the unit tests run it in node.
//
// All rects are in one coordinate space at a time (world for selection and
// resize maths, screen only where the caller converted first); nothing here
// knows about the camera.

import { STICKY_SIZE_WORLD } from './config';

/** A point, in whatever space the caller works in. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles, named for the side(s) they drag. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Fixed draw order, so overlays and tests see one order. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteRect(rect: Rect): boolean {
  return finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height);
}

/**
 * True when `inner` lies entirely inside `outer`: all four of the inner
 * edges are on or within the outer ones. An object that only touches the
 * marquee from outside, or cuts a corner across it, is not contained.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (!finiteRect(outer) || !finiteRect(inner)) return false;
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The smallest rect holding all the given ones, or null when none is usable
 * (an empty list, or only non-finite rects). Non-finite rects are skipped.
 */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let used = 0;

  for (const rect of rects) {
    if (!finiteRect(rect)) continue;
    used += 1;
    x0 = Math.min(x0, rect.x);
    y0 = Math.min(y0, rect.y);
    x1 = Math.max(x1, rect.x + rect.width);
    y1 = Math.max(y1, rect.y + rect.height);
  }
  if (used === 0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The rect whose opposite corners are the two points, so a marquee reads the
 * same dragged backwards. A non-finite point gives the zero rect at (0, 0).
 */
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
 * The rectangle a snapshot-like object covers: its position plus its stored
 * size, defaulting per axis to the size a fresh sticky note has - the only
 * sized type this build ships. Stories 9+ pass their own default through
 * `defaultSize` when their objects arrive.
 */
export interface SizedObjectLike {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export function objectBounds<T extends SizedObjectLike>(
  object: T,
  defaultSize = STICKY_SIZE_WORLD,
): Rect {
  const width = finite(object.width) ? object.width : defaultSize;
  const height = finite(object.height) ? object.height : defaultSize;
  return { x: object.x, y: object.y, width, height };
}

/** True when the handle drags the left edge; null when it does not drag sideways. */
function dragsX(handle: Handle): 'w' | 'e' | null {
  if (handle.includes('w')) return 'w';
  if (handle.includes('e')) return 'e';
  return null;
}

/** True when the handle drags the top edge, false when the bottom (neither for e/w). */
function dragsY(handle: Handle): 'n' | 's' | null {
  if (handle.includes('n')) return 'n';
  if (handle.includes('s')) return 's';
  return null;
}

/**
 * Drag one handle of `start` by `delta` (same world units), the opposite side
 * or corner acting as the anchor. With `aspectLocked` the bounding keeps the
 * start ratio: the dragged axis that moves furthest (as a scale) decides, and
 * edge handles scale the other axis the same amount around their centre.
 *
 * A non-finite start or delta returns `start` untouched: a broken frame of a
 * gesture must never corrupt the box.
 */
export function resizeRect(start: Rect, handle: Handle, delta: Point, aspectLocked: boolean): Rect {
  if (!finiteRect(start) || !finite(delta.x) || !finite(delta.y)) return start;

  const axisX = dragsX(handle);
  const axisY = dragsY(handle);
  if (axisX === null && axisY === null) return start;

  let width = start.width;
  let height = start.height;
  if (axisX !== null) width = start.width + (axisX === 'e' ? delta.x : -delta.x);
  if (axisY !== null) height = start.height + (axisY === 's' ? delta.y : -delta.y);

  // The lock binds corners only: an edge handle exists to change one axis, and
  // the TCs say so ("edge handle changes width only"). A corner drag that asks
  // for the lock scales both axes by the larger of the two ratios.
  if (aspectLocked && axisX !== null && axisY !== null) {
    const scale = Math.max(0, Math.max(width / start.width, height / start.height));
    if (!finite(scale)) return start;
    width = start.width * scale;
    height = start.height * scale;
  }

  // The anchor: the opposite edge (or corner) keeps its coordinates.
  let x = start.x;
  let y = start.y;
  if (axisX === 'w') x = start.x + start.width - width;
  if (axisY === 'n') y = start.y + start.height - height;

  return { x, y, width, height };
}

/**
 * The single scale, per axis, that the whole selection's resize may use: every
 * object's own size must stay at or above its own `minSizes` entry and at or
 * below `maxSize` on every edge. The first object to reach a bound stops the
 * drag for all of them, which is what keeps relative layout intact - one
 * scale is applied to every object, never one object's own.
 *
 * A non-finite requested scale comes back as {1, 1}: nothing may change.
 */
export function clampScale(
  scale: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  maxSize: number,
): Point {
  if (!finite(scale.x) || !finite(scale.y)) return { x: 1, y: 1 };

  let loX = 0;
  let loY = 0;
  let hiX = Number.POSITIVE_INFINITY;
  let hiY = Number.POSITIVE_INFINITY;

  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    const min = minSizes[i];
    if (!finiteRect(rect) || !finite(min)) continue;
    if (rect.width > 0) {
      loX = Math.max(loX, min / rect.width);
      hiX = Math.min(hiX, maxSize / rect.width);
    }
    if (rect.height > 0) {
      loY = Math.max(loY, min / rect.height);
      hiY = Math.min(hiY, maxSize / rect.height);
    }
  }

  return {
    x: Math.min(Math.max(scale.x, loX), hiX),
    y: Math.min(Math.max(scale.y, loY), hiY),
  };
}

/**
 * The box `start` becomes when scaled by `scale` around the handle's anchor:
 * the opposite edge (or corner) keeps its coordinates, exactly as in
 * resizeRect. This is the second half of a resize frame - resizeRect finds
 * the scale the pointer asks for, clampScale stops it at the bounds, and
 * anchorBox applies the scale that survived. An axis the handle does not
 * drag is only touched when `aspectLocked` says so, which is how a locked
 * corner still scales both axes. (A caller that computed `scale` from
 * resizeRect passes 1 on an undragged axis, so the product changes nothing.)
 */
export function anchorBox(start: Rect, handle: Handle, scale: Point, aspectLocked = false): Rect {
  if (!finiteRect(start) || !finite(scale.x) || !finite(scale.y)) return start;
  const axisX = dragsX(handle);
  const axisY = dragsY(handle);

  let x = start.x;
  let width = start.width;
  if (axisX === 'e') {
    width = start.width * scale.x;
  } else if (axisX === 'w') {
    width = start.width * scale.x;
    x = start.x + start.width - width;
  } else if (aspectLocked) {
    width = start.width * scale.x;
    x = start.x + (start.width - width) / 2;
  }

  let y = start.y;
  let height = start.height;
  if (axisY === 's') {
    height = start.height * scale.y;
  } else if (axisY === 'n') {
    height = start.height * scale.y;
    y = start.y + start.height - height;
  } else if (aspectLocked) {
    height = start.height * scale.y;
    y = start.y + (start.height - height) / 2;
  }

  return { x, y, width, height };
}

/**
 * Where `child` lands when the box `from` is mapped onto the box `to`: sizes
 * multiply by the axis scales, and so do the offsets from `from`'s corner -
 * doubling the box doubles the gaps as well as the objects inside it.
 *
 * A degenerate (zero-sized or non-finite) `from` or `to`, or one whose scale
 * is not finite, returns `child` unchanged.
 */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  if (!finiteRect(child) || !finiteRect(from) || !finiteRect(to)) return child;
  if (from.width <= 0 || from.height <= 0) return child;

  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (!finite(sx) || !finite(sy)) return child;

  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    width: child.width * sx,
    height: child.height * sy,
  };
}
