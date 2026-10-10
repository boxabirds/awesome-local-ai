/**
 * Pure camera maths for the infinite board. No DOM, no React.
 *
 * Coordinate model:
 *   - world units: board coordinates; (0, 0) is the board's starting point.
 *   - camera `{ x, y, zoom }`: `x, y` is the world coordinate shown at the
 *     top-left of the viewport; `zoom` is screen pixels per world unit.
 *   - `screen = (world - camera.xy) * zoom`
 *   - `world  = screen / zoom + camera.xy`
 *
 * Camera values are immutable: every function returns a new `Camera`, or the
 * *same object* when nothing would change (limit reached, zero delta, invalid
 * input) so React can skip re-rendering. Invalid input never throws.
 */

import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_SCALE,
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

/** Zoom at which the board is shown 1:1. */
export const DEFAULT_ZOOM = 1;

/** The camera before the viewport has been measured. */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: DEFAULT_ZOOM };

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isValidNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the board by a screen-space pointer delta (drag or plain scroll).
 * `x` and `y` are unbounded, so the board has no edges.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!isValidNumber(screenDx) || !isValidNumber(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Change the zoom around a screen point, keeping the board location under that
 * point at the same screen position. Clamped to `[ZOOM_MIN, ZOOM_MAX]`.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidNumber(factor) || factor <= 0) return cam;
  if (!isValidNumber(screenPoint.x) || !isValidNumber(screenPoint.y)) return cam;
  return zoomToPoint(cam, screenPoint, clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
}

function zoomToPoint(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (!isValidNumber(newZoom) || newZoom === cam.zoom) return cam;
  const underPointer = screenToWorld(cam, screenPoint);
  return {
    x: underPointer.x - screenPoint.x / newZoom,
    y: underPointer.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom values reached by stepping snap to the nearest `ZOOM_STEP_FACTOR^n` when
 * close enough, so stepping in and then out returns exactly the zoom it started
 * from (no floating-point drift in the percentage label).
 */
function snapToStep(zoom: number): number {
  if (!isValidNumber(zoom) || zoom <= 0) return zoom;
  const power = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, power);
  if (Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON * Math.max(1, zoom)) return snapped;
  return zoom;
}

/** Zoom one step in or out around the centre of the board area. */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const raw =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  const target = clamp(snapToStep(raw), ZOOM_MIN, ZOOM_MAX);
  return zoomToPoint(cam, centre, target);
}

/** The standard view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return {
    x: -viewport.width / 2,
    y: -viewport.height / 2,
    zoom: DEFAULT_ZOOM,
  };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX - ZOOM_STEP_SNAP_EPSILON;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + ZOOM_STEP_SNAP_EPSILON;
}

/** The zoom as a whole-number percentage, e.g. 1.5625 -> 156. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * ZOOM_PERCENT_SCALE);
}
