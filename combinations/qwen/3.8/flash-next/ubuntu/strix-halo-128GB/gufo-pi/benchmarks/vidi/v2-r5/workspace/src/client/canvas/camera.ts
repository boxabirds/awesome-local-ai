/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model:
 * - World units are board coordinates; the origin (0, 0) is the board's starting point.
 * - The camera `{ x, y, zoom }` places the world coordinate (x, y) at the top-left of the
 *   viewport; `zoom` is screen pixels per world unit.
 * - `screen = (world - camera.xy) * zoom`, `world = screen / zoom + camera.xy`.
 *
 * Every function is pure and immutable: it returns a *new* Camera, or the *same* object
 * when nothing would change, so React can skip re-rendering. Invalid input never throws —
 * input handlers must not be able to crash the board.
 *
 * No edges: `x` and `y` are unbounded doubles with no clamping, so the user can pan at
 * least UNBOUNDED_PAN_TESTED_EXTENT board units from the start. Doubles keep sub-pixel
 * precision at that distance even at ZOOM_MAX.
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

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

/** A factor the maths can act on: finite and strictly positive. */
const isValidFactor = (factor: number): boolean => isFiniteNumber(factor) && factor > 0;

const isValidPoint = (p: Point): boolean => isFiniteNumber(p.x) && isFiniteNumber(p.y);

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Move the camera by a screen-space pointer delta (the board follows the pointer). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!isFiniteNumber(screenDx) || !isFiniteNumber(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/** Core zoom: set the zoom to `newZoom` while keeping the world point under `screenPoint` put. */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (!isValidPoint(screenPoint)) return cam;
  if (!isFiniteNumber(newZoom)) return cam;
  const clamped = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  if (clamped === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return { x: world.x - screenPoint.x / clamped, y: world.y - screenPoint.y / clamped, zoom: clamped };
}

/**
 * Zoom by `factor` around a screen point, clamped to [ZOOM_MIN, ZOOM_MAX].
 * An invalid factor (<= 0, NaN, +/-Infinity) returns the input camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

const viewportCentre = (viewport: Size): Point => ({
  x: viewport.width / 2,
  y: viewport.height / 2,
});

/**
 * Snap a zoom to the nearest exact power of ZOOM_STEP_FACTOR when it is close enough,
 * so a step in followed by a step out lands on exactly the value it started from
 * (1.25 * 0.8 is not exactly 1 in floating point).
 */
function snapToStep(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  if (!isFiniteNumber(snapped)) return zoom;
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, zoom);
  return Math.abs(snapped - zoom) <= tolerance ? snapped : zoom;
}

/** Zoom one step in or out around the centre of the viewport. */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStep(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  return zoomTo(cam, viewportCentre(viewport), target);
}

/** Standard view: 100% zoom with the board's starting point centred in the viewport. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Current zoom as a whole-number percentage (1.5625 -> 156). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
