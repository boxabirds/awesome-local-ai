/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model (design "Coordinate model"):
 *  - World units are board coordinates; the origin (0,0) is the board's
 *    starting point.
 *  - The camera is `{ x, y, zoom }` where `x, y` is the world coordinate shown
 *    at the *top-left* of the viewport and `zoom` is screen pixels per world
 *    unit.
 *  - `screen = (world - camera.xy) * zoom`, `world = screen / zoom + camera.xy`.
 *
 * Every function is pure and returns a *new* Camera, except when the result
 * would be identical to the input (limit reached, zero delta, invalid factor):
 * then the same object is returned so React can skip a re-render. Invalid
 * values never throw - input handlers must not be able to crash the board.
 */
import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_RELATIVE_EPSILON,
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

/** A camera with the viewport centred on the board origin at 100%. */
export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Pan by a screen-space delta in CSS pixels (pointer / wheel deltas). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/**
 * Snap to the nearest `ZOOM_STEP_FACTOR^n` so that a step in followed by a
 * step out returns to exactly the zoom it started from (no float drift).
 */
function snapToStep(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = ZOOM_STEP_SNAP_RELATIVE_EPSILON * Math.max(1, Math.abs(snapped));
  return Math.abs(snapped - zoom) <= tolerance ? snapped : zoom;
}

/** True for values that can be used as a zoom multiplier. */
function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/**
 * Zoom around a screen-space point: the world point under `screenPoint` stays
 * at the same screen position. Out-of-range zoom is clamped; an invalid factor
 * leaves the camera untouched.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const nextZoom = snapToStep(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  if (nextZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / nextZoom,
    y: anchor.y - screenPoint.y / nextZoom,
    zoom: nextZoom,
  };
}

export function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

/** One step in or out, around the centre of the viewport. */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const factor =
    direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  return zoomAt(cam, viewportCentre(viewport), factor);
}

/** Standard view: 100% zoom with the board origin centred in the viewport. */
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
 * Euclidean modulo: unlike `%` it keeps its sign for negative dividends, which
 * is what tiling a repeating background needs.
 */
export function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}
