/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model:
 *  - World units are board coordinates; (0, 0) is the board's starting point.
 *  - The camera's `x, y` is the world coordinate shown at the viewport top-left;
 *    `zoom` is screen pixels per world unit.
 *  - screen = (world - camera.xy) * zoom, world = screen / zoom + camera.xy.
 *
 * Every function is pure and returns the *same object* when nothing would change,
 * so React can skip re-rendering. Invalid input is ignored rather than thrown:
 * input handlers must never crash the board.
 *
 * No DOM and no React in this module.
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export type ZoomDirection = 'in' | 'out';

/** Zoom is reported as a percentage of 1. */
const PERCENT = 100;
/** Centre of the viewport is half its width/height. */
const HALF = 2;
/** A stepped zoom this close to ZOOM_STEP_FACTOR^n is snapped to it (keeps steps exact). */
const STEP_SNAP_EPSILON = 1e-9;
const LOG_ZOOM_STEP = Math.log(ZOOM_STEP_FACTOR);

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/** Snap a stepped zoom onto the nearest exact power of ZOOM_STEP_FACTOR. */
function snapToStep(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / LOG_ZOOM_STEP);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  return Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON ? snapped : zoom;
}

function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / HALF, y: viewport.height / HALF };
}

/** Scale around a fixed screen point, keeping the world point under it in place. */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
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

/** Move the camera by a screen-space pointer delta; content moves with the pointer. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const requested = cam.zoom * factor;
  if (Number.isNaN(requested)) return cam;
  return zoomTo(cam, screenPoint, clamp(requested, ZOOM_MIN, ZOOM_MAX));
}

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const stepped = direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  return zoomTo(cam, viewportCentre(viewport), clamp(snapToStep(stepped), ZOOM_MIN, ZOOM_MAX));
}

/** Standard view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / HALF, y: -viewport.height / HALF, zoom: 1 };
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
