/**
 * Pure camera maths for the infinite board.
 *
 * World units are board coordinates; the origin (0,0) is the board's starting
 * point. A camera `{ x, y, zoom }` places the world coordinate (x, y) at the
 * top-left of the viewport, with `zoom` screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom      + camera.xy
 *
 * Every function is pure and immutable: it returns a *new* Camera, or the *same*
 * object when nothing would change, so React can skip re-renders. Invalid input
 * never throws — the input handlers must not be able to crash the board.
 *
 * No DOM and no React imports: this module is pure.
 */

import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/** Camera state: the world coordinate at the viewport top-left, plus zoom. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A point in screen (CSS pixel) or world space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A viewport size in CSS pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The board's starting point in world coordinates. */
export const WORLD_ORIGIN: Point = { x: 0, y: 0 };

/** A camera is usable only when every component is a finite number. */
function isFiniteCamera(cam: Camera): boolean {
  return Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.zoom);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Snap `zoom` to the nearest exact power of {@link ZOOM_STEP_FACTOR} when it is
 * within {@link ZOOM_STEP_SNAP_EPSILON} (relative) of it, so a step in followed
 * by a step out returns exactly the value it started from.
 */
function snapToStepGrid(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  if (Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON * Math.max(zoom, 1)) {
    return snapped;
  }
  return zoom;
}

/** Centre of a viewport, in screen coordinates. */
export function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the camera by the inverse of a screen-space pointer delta, so board
 * content follows the pointer exactly. A zero delta returns the same object.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!isFiniteCamera(cam) || cam.zoom <= 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` keeping the world point under `screenPoint` at the same
 * screen position. The result is clamped to [ZOOM_MIN, ZOOM_MAX].
 *
 * Returns `cam` unchanged when the factor is invalid (<= 0, NaN, +/-Infinity)
 * or when clamping means the zoom would not change.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!isFiniteCamera(cam) || cam.zoom <= 0) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom one step ({@link ZOOM_STEP_FACTOR}) in or out around the centre of the
 * viewport, so the board location at the centre stays at the same screen
 * position. Step results snap to exact powers of the step factor.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const stepped =
    direction === 'in'
      ? zoomAt(cam, viewportCentre(viewport), ZOOM_STEP_FACTOR)
      : zoomAt(cam, viewportCentre(viewport), 1 / ZOOM_STEP_FACTOR);
  if (stepped === cam) return cam;
  const snapped = snapToStepGrid(stepped.zoom);
  if (snapped === stepped.zoom) return stepped;
  // Re-derive the camera for the snapped zoom so the centre stays fixed.
  return zoomAt(cam, viewportCentre(viewport), snapped / cam.zoom);
}

/** 100% zoom with the board's starting point centred in the viewport. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** The zoom as a whole-number percentage for the on-screen label. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
