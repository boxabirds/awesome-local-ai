import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_SCALE,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_RELATIVE,
} from '../../shared/config';

/**
 * Camera: `x, y` is the world coordinate shown at the top-left of the board
 * area; `zoom` is screen pixels per world unit.
 *
 * screen = (world - camera.xy) * zoom
 * world  =  screen / zoom + camera.xy
 *
 * All functions are pure: they return a new immutable Camera, or the *same*
 * object when nothing would change so React can skip re-rendering. Invalid
 * input (a non-finite or non-positive zoom factor) returns the input camera
 * unchanged — an input handler must never crash the board.
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

export type ZoomDirection = 'in' | 'out';

/** The camera at the board's starting point before the area is measured. */
export const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: ZOOM_DEFAULT };

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const isFinitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

const isValidFactor = (factor: number): boolean => Number.isFinite(factor) && factor > 0;

/** The centre of the board area, in screen coordinates. */
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
 * Move the camera so the board follows the pointer by (screenDx, screenDy)
 * screen pixels. There is no clamping on x/y, so the board is unbounded.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  const dx = Number.isFinite(screenDx) ? screenDx : 0;
  const dy = Number.isFinite(screenDy) ? screenDy : 0;
  if (dx === 0 && dy === 0) return cam;
  return { x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` keeping the board location under `screenPoint` at the same
 * screen position. The result is clamped to [ZOOM_MIN, ZOOM_MAX].
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor) || !isFinitePoint(screenPoint)) return cam;
  const zoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (zoom === cam.zoom) return cam;
  return placeWithZoomAt(cam, screenPoint, zoom);
}

/**
 * Place the camera at `zoom` (already clamped) so the board point currently at
 * `screenPoint` stays at `screenPoint`.
 */
function placeWithZoomAt(cam: Camera, screenPoint: Point, zoom: number): Camera {
  const world = screenToWorld(cam, screenPoint);
  return { x: world.x - screenPoint.x / zoom, y: world.y - screenPoint.y / zoom, zoom };
}

/**
 * Snap a zoom that is only a rounding error away from `ZOOM_STEP_FACTOR ** n`
 * onto it, so stepping in then out returns exactly the zoom it started from.
 */
function snapToStep(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  if (!Number.isFinite(exponent)) return zoom;
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  if (Math.abs(zoom - snapped) <= ZOOM_STEP_SNAP_RELATIVE * Math.abs(zoom)) return snapped;
  return zoom;
}

/**
 * One zoom step around the centre of the board area, so the board location at
 * the centre stays at the same screen position.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStep(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  if (target === cam.zoom) return cam;
  return placeWithZoomAt(cam, viewportCentre(viewport), target);
}

/** Standard view: 100% with the board's starting point centred in the area. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: ZOOM_DEFAULT };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** The zoom as a whole-number percentage, e.g. 1.5625 -> 156. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * ZOOM_PERCENT_SCALE);
}
