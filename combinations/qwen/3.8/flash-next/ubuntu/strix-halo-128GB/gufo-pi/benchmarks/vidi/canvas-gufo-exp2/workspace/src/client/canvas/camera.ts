import {
  PERCENT_PER_UNIT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../shared/config';

/**
 * Pure camera maths for the infinite board.
 *
 * Camera `{ x, y, zoom }`: `x, y` is the world coordinate shown at the
 * top-left of the viewport; `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom      + camera.xy
 *
 * Every function is immutable: it returns a *new* Camera, or the *same*
 * object when the result would be identical (limit reached, zero delta), so
 * React can skip a re-render. Invalid input never throws: it returns the
 * input camera unchanged, because input handlers must not crash the board.
 *
 * No DOM and no React in this module.
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

/** A zoom this close to an exact `ZOOM_STEP_FACTOR^n` is snapped to it. */
const ZOOM_SNAP_RELATIVE_EPSILON = 1e-9;

/** Screen pixels that make the zoom exactly ZOOM_MAX (for limit comparisons). */
const LIMIT_EPSILON = 1e-12;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Snap a zoom to the nearest `ZOOM_STEP_FACTOR^n` when it is within
 * ZOOM_SNAP_RELATIVE_EPSILON of it, so a step in followed by a step out
 * returns exactly the value it started from.
 */
function snapZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const exact = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = ZOOM_SNAP_RELATIVE_EPSILON * Math.max(1, Math.abs(zoom));
  return Math.abs(zoom - exact) <= tolerance ? exact : zoom;
}

/** A factor the camera can act on: finite and strictly positive. */
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
 * Move the camera by a pointer movement given in screen pixels: the board
 * follows the pointer exactly, so the camera moves the other way.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Multiply the zoom by `factor` while keeping the world location under
 * `screenPoint` at the same screen position. Clamped to [ZOOM_MIN, ZOOM_MAX];
 * an invalid factor or a zoom already at a limit returns `cam` unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const underPointer = screenToWorld(cam, screenPoint);
  return {
    x: underPointer.x - screenPoint.x / newZoom,
    y: underPointer.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * One zoom step (toolbar buttons, keyboard shortcuts) around the centre of
 * the viewport.
 */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const from = snapZoom(cam.zoom);
  const target = clamp(snapZoom(from * factor), ZOOM_MIN, ZOOM_MAX);
  if (target === cam.zoom) return cam;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const underCentre = screenToWorld(cam, centre);
  return {
    x: underCentre.x - centre.x / target,
    y: underCentre.y - centre.y / target,
    zoom: target,
  };
}

/** Standard view: 100 % zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom * (1 + LIMIT_EPSILON) < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom / (1 + LIMIT_EPSILON) > ZOOM_MIN;
}

/** Current zoom as a whole-number percentage (1 -> 100). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT_PER_UNIT);
}
