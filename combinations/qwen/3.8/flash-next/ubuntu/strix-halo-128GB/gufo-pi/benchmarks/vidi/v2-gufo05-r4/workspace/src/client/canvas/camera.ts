/**
 * Pure camera maths for the infinite board.
 *
 * World units are board coordinates; the board's starting point is world (0, 0).
 * The camera's `x, y` is the world coordinate shown at the top-left of the
 * viewport and `zoom` is screen pixels per world unit:
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom + camera.xy
 *
 * `x` and `y` are unbounded doubles with no clamping, so the board has no
 * edges: the user can pan at least UNBOUNDED_PAN_TESTED_EXTENT world units from
 * the start in any direction and still keep sub-pixel precision (a double holds
 * ~15 significant digits, so at 1e6 world units the rounding error is ~1e-10).
 *
 * No DOM and no React imports: everything here is pure and testable in node.
 */

import {
  PERCENT_PER_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_TOLERANCE
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

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value > max) return max; // also handles +Infinity
  if (value < min) return min; // also handles -Infinity
  return value;
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the camera by the opposite of a screen-space pointer delta, so board
 * content follows the pointer exactly. A zero delta returns the same object.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom around a screen point: the world location under `screenPoint` stays at
 * the same screen position. Invalid factors (non-finite or <= 0) and factors
 * that would not change the zoom (a limit was reached) return the input camera
 * unchanged, so React can skip a render and input handlers never crash.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / newZoom,
    y: anchor.y - screenPoint.y / newZoom,
    zoom: newZoom
  };
}

/**
 * Snap a zoom to the nearest exact power of ZOOM_STEP_FACTOR when it is already
 * within tolerance, so "zoom in then zoom out" lands back on exactly 1.0
 * instead of drifting by one float epsilon every round trip.
 */
function snapToStepGrid(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  if (!Number.isFinite(exponent)) return zoom;
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = ZOOM_STEP_SNAP_TOLERANCE * Math.max(1, Math.abs(zoom));
  return Math.abs(snapped - zoom) <= tolerance ? snapped : zoom;
}

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam;
  const snapped = snapToStepGrid(stepped.zoom);
  if (snapped === stepped.zoom) return stepped;
  if (snapped === cam.zoom) return cam;
  const anchor = screenToWorld(cam, centre);
  return {
    x: anchor.x - centre.x / snapped,
    y: anchor.y - centre.y / snapped,
    zoom: snapped
  };
}

/** Standard view: 100% zoom with the board's starting point centred. */
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
  return Math.round(cam.zoom * PERCENT_PER_ZOOM);
}
