import {
  PERCENT_PER_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/**
 * The camera is the only board state: `x`, `y` is the world coordinate shown at the
 * viewport's top-left, `zoom` is screen pixels per world unit.
 *
 * `screen = (world - camera.xy) * zoom`, `world = screen / zoom + camera.xy`.
 */
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

/** The camera seen when the board opens: world origin at the viewport top-left, 1:1. */
export const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Smallest/largest zoom as whole-number percentages, e.g. 10 and 400. */
export const ZOOM_MIN_PERCENT = Math.round(ZOOM_MIN * PERCENT_PER_ZOOM);
export const ZOOM_MAX_PERCENT = Math.round(ZOOM_MAX * PERCENT_PER_ZOOM);

const ONE = 1;
const ZOOM_STEP_INVERSE_FACTOR = 1 / ZOOM_STEP_FACTOR;
const LOG_STEP = Math.log(ZOOM_STEP_FACTOR);

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(p: Point): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Screen-space drag: the board content moves by exactly the pointer's delta. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!isFiniteNumber(screenDx) || !isFiniteNumber(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom keeping the board location under `screenPoint` at the same screen position.
 * Invalid factors (non-finite or <= 0) leave the camera unchanged; the result is
 * clamped to [ZOOM_MIN, ZOOM_MAX] and returns the input object when nothing changed.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isFiniteNumber(factor) || factor <= 0) return cam;
  if (!isFinitePoint(screenPoint)) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

function zoomTo(cam: Camera, screenPoint: Point, targetZoom: number): Camera {
  if (!isFiniteNumber(targetZoom)) return cam;
  const newZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** Snap to the nearest ZOOM_STEP_FACTOR^n so 1.25 then its inverse gives exactly 1. */
function snapToStepLadder(zoom: number): number {
  const steps = Math.round(Math.log(zoom) / LOG_STEP);
  const snapped = ZOOM_STEP_FACTOR ** steps;
  if (!isFiniteNumber(snapped)) return zoom;
  if (Math.abs(snapped - zoom) > ZOOM_STEP_SNAP_EPSILON) return zoom;
  return snapped;
}

/** One zoom step around the centre of the board area. */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const raw =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom * ZOOM_STEP_INVERSE_FACTOR;
  return zoomTo(cam, centre, snapToStepLadder(raw));
}

/** 100% zoom with the board's starting point (world 0,0) centred in the board area. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: ONE };
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
