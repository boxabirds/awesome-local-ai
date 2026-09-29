/**
 * Pure camera maths for the infinite board. No DOM, no React.
 *
 * Contract (design "camera.math"):
 * - `Camera.x, y` is the world coordinate shown at the top-left of the board
 *   area; `zoom` is screen pixels per world unit.
 * - `screen = (world - camera.xy) * zoom`, `world = screen / zoom + camera.xy`.
 * - Every function returns a new immutable Camera, or the *same object* when
 *   nothing changes, so React can skip a re-render.
 * - Invalid input never throws: handlers must not be able to crash the board.
 *
 * There are no edges: `x` and `y` are unbounded doubles with no clamping, so
 * panning `UNBOUNDED_PAN_TESTED_EXTENT` (1,000,000) world units from the start
 * keeps sub-pixel precision even at `ZOOM_MAX`.
 */

import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Move the board by a screen-space pointer delta (drag or plain scroll). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Multiply the zoom by `factor` while keeping the world location under
 * `screenPoint` at the same screen position. Clamped to [ZOOM_MIN, ZOOM_MAX];
 * an invalid factor or a limit already reached returns `cam` unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  const target = clampZoom(cam.zoom * factor);
  if (!Number.isFinite(target) || target === cam.zoom) return cam;
  return zoomKeepingPoint(cam, screenPoint, target);
}

/**
 * One zoom step around the centre of the board area. Results snap back onto the
 * `ZOOM_STEP_FACTOR^n` grid when within `ZOOM_STEP_SNAP_EPSILON`, so 1.0 -> +
 * -> - returns exactly 1.0 instead of 1.0000000000000002.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStepGrid(clampZoom(cam.zoom * factor));
  if (!Number.isFinite(target) || target === cam.zoom) return cam;
  return zoomKeepingPoint(cam, { x: viewport.width / 2, y: viewport.height / 2 }, target);
}

/** 100% zoom with the board's starting point (world 0,0) centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}

/**
 * Clamp to [ZOOM_MIN, ZOOM_MAX]. `+Infinity` lands on the maximum and
 * `-Infinity` on the minimum; NaN is passed through so callers can bail out.
 */
function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return Number.NaN;
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
}

function zoomKeepingPoint(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** Snap `zoom` to the nearest `ZOOM_STEP_FACTOR^n` when very close to one. */
function snapToStepGrid(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, Math.abs(zoom));
  return Math.abs(zoom - snapped) <= tolerance ? clampZoom(snapped) : zoom;
}
