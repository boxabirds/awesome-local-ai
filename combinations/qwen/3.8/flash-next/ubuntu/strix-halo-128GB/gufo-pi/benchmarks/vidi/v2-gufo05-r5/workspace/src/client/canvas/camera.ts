/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model:
 *  - World units are board coordinates; the origin (0,0) is the board's starting point.
 *  - The camera's `x, y` is the world coordinate shown at the top-left of the viewport;
 *    `zoom` is screen pixels per world unit.
 *  - screen = (world - camera.xy) * zoom, world = screen / zoom + camera.xy.
 *
 * Every function is pure and immutable: it returns a *new* Camera, or the *same*
 * object when nothing would change, so React can skip re-rendering.
 *
 * There is no clamping on `x`/`y`: the board is unbounded, and double precision keeps
 * sub-pixel accuracy far beyond UNBOUNDED_PAN_TESTED_EXTENT world units even at
 * ZOOM_MAX, so no re-basing is needed.
 */
import {
  PERCENT,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_TOLERANCE,
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

export type ZoomDirection = 'in' | 'out';

const LOG_ZOOM_STEP = Math.log(ZOOM_STEP_FACTOR);

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isUsableZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom > 0;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Zoom drifts away from the conceptual ladder ZOOM_STEP_FACTOR^n through repeated
 * multiplication; pull it back onto the ladder when it is within
 * ZOOM_STEP_SNAP_TOLERANCE of a rung, so 100% -> + -> - is exactly 100% again.
 */
function snapToZoomStep(zoom: number): number {
  if (!isUsableZoom(zoom)) return zoom;
  const rung = Math.round(Math.log(zoom) / LOG_ZOOM_STEP);
  const snapped = ZOOM_STEP_FACTOR ** rung;
  if (snapped < ZOOM_MIN || snapped > ZOOM_MAX) return zoom;
  const tolerance = ZOOM_STEP_SNAP_TOLERANCE * Math.max(1, Math.abs(snapped));
  return Math.abs(zoom - snapped) <= tolerance ? snapped : zoom;
}

function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

/**
 * Sets the zoom to `newZoom` while keeping the world point currently under
 * `screenPoint` at that same screen position.
 */
function zoomToPoint(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Moves the camera by the inverse of a screen-space pointer/scroll delta. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zooms by `factor` around a screen point. A factor that is not a positive finite
 * number is ignored (input handlers must never crash the board); the result is
 * clamped to [ZOOM_MIN, ZOOM_MAX].
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!isUsableZoom(cam.zoom) || !isFinitePoint(screenPoint)) return cam;
  const newZoom = snapToZoomStep(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  return zoomToPoint(cam, screenPoint, newZoom);
}

/** One zoom step (ZOOM_STEP_FACTOR or its inverse) around the viewport centre. */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  if (!isUsableZoom(cam.zoom)) return cam;
  const rawTarget =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  const target = snapToZoomStep(clamp(rawTarget, ZOOM_MIN, ZOOM_MAX));
  return zoomToPoint(cam, viewportCentre(viewport), target);
}

/** The standard view: 100% with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  const centre = viewportCentre(viewport);
  return { x: -centre.x, y: -centre.y, zoom: ZOOM_DEFAULT };
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
