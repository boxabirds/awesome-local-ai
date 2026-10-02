/**
 * Pure camera maths for the infinite board.
 *
 * The camera describes which part of the board is on screen:
 * `x, y` is the world coordinate shown at the top-left of the board area and
 * `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * Every function is pure and returns a new immutable Camera; when the result
 * would be identical to the input (limit reached, zero delta) the *same object*
 * is returned so React can skip a re-render. Invalid input never throws: board
 * input handlers must not be able to crash the app.
 *
 * `x` and `y` are unbounded doubles with no clamping, so the board has no
 * edges: at UNBOUNDED_PAN_TESTED_EXTENT (1,000,000 world units) from the start
 * a double still carries sub-pixel precision even at ZOOM_MAX.
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

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

/** Zoom directions accepted by {@link zoomStep}. */
export type ZoomDirection = 'in' | 'out';

/**
 * Zoom values produced by repeated stepping are snapped to the nearest exact
 * power of ZOOM_STEP_FACTOR within this epsilon, so a step in and a step out
 * returns exactly the zoom it started from instead of drifting.
 */
export const ZOOM_SNAP_EPSILON = 1e-9;

/** Zoom is shown to the user as a percentage: 1 -> 100%. */
export const PERCENT_PER_ZOOM = 100;

const LOG_STEP = Math.log(ZOOM_STEP_FACTOR);

function clampZoom(zoom: number): number {
  if (zoom < ZOOM_MIN) return ZOOM_MIN;
  if (zoom > ZOOM_MAX) return ZOOM_MAX;
  return zoom;
}

/** A zoom factor is usable only when it is a positive, finite number. */
function isValidFactor(factor: number): boolean {
  return typeof factor === 'number' && factor > 0 && Number.isFinite(factor);
}

/** Snap to the nearest ZOOM_STEP_FACTOR^n, but only when very close to it. */
function snapZoom(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / LOG_STEP);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  return Math.abs(snapped - zoom) <= ZOOM_SNAP_EPSILON * Math.max(1, Math.abs(snapped))
    ? snapped
    : zoom;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: cam.x + p.x / cam.zoom, y: cam.y + p.y / cam.zoom };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the board by a screen-space pointer delta: the content follows the
 * pointer by exactly (screenDx, screenDy) CSS pixels.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` keeping the world point under `screenPoint` at the same
 * screen position. Clamped to [ZOOM_MIN, ZOOM_MAX]; invalid factors and zooms
 * that would pass a limit return the input camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * One zoom step (button or keyboard shortcut) around the centre of the board
 * area, so the board location at the centre stays at the same screen position.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const raw = cam.zoom * factor;
  if (!Number.isFinite(raw)) return cam;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const newZoom = clampZoom(snapZoom(raw));
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, centre);
  return {
    x: world.x - centre.x / newZoom,
    y: world.y - centre.y / newZoom,
    zoom: newZoom,
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
