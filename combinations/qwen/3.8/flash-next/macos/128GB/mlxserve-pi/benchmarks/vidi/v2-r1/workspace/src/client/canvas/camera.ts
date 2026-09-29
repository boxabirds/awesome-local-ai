import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

/**
 * Camera maths: pure world<->screen transforms, pan, zoom-at-point and
 * clamping. No DOM, no React. See design.md "Camera maths" (anchor camera.math).
 *
 * Coordinate model:
 *  - World units: board coordinates; origin (0,0) is the board's starting point.
 *  - Camera { x, y, zoom }: x, y is the world coordinate shown at the top-left
 *    of the viewport; zoom is screen pixels per world unit.
 *  - screen = (world - camera.xy) * zoom; world = screen / zoom + camera.xy.
 *
 * Camera positions are two unbounded double-precision numbers with no clamping
 * on x/y, so the user can pan at least UNBOUNDED_PAN_TESTED_EXTENT (1,000,000)
 * world units in any direction with no edge and no visible grid distortion.
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

/** Zoom steps snap to the nearest ZOOM_STEP_FACTOR^n within this (absolute-ish)
 * tolerance, so a step in followed by a step out returns exactly 1.0. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier turning a zoom level into a displayed percentage. */
export const PERCENT = 100;

const LOG_ZOOM_STEP = Math.log(ZOOM_STEP_FACTOR);

const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** Nearest power of ZOOM_STEP_FACTOR to `zoom`, or `zoom` itself when no power
 * is close enough to be a float-drift of it. Never used to widen the limits. */
function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / LOG_ZOOM_STEP);
  const candidate = ZOOM_STEP_FACTOR ** n;
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, candidate);
  return Math.abs(zoom - candidate) <= tolerance ? candidate : zoom;
}

/** Multiply/divide by the step factor, snap float drift, then clamp. */
function stepZoom(zoom: number, direction: 'in' | 'out'): number {
  const raw = direction === 'in' ? zoom * ZOOM_STEP_FACTOR : zoom / ZOOM_STEP_FACTOR;
  if (!Number.isFinite(raw) || raw <= 0) return zoom;
  return clampZoom(snapToStep(raw));
}

/** Recompute the camera top-left so `world` stays at `screenPoint`. */
function anchorAt(world: Point, screenPoint: Point, zoom: number): Camera {
  return { x: world.x - screenPoint.x / zoom, y: world.y - screenPoint.y / zoom, zoom };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Move the camera by the negative of a screen-space pointer delta, so board
 * content follows the pointer exactly. A zero delta returns the same object. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/** Zoom around a screen point, keeping the world point under it fixed.
 * An invalid factor (<= 0, NaN, +/-Infinity) or a clamped no-op returns `cam`. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  return anchorAt(screenToWorld(cam, screenPoint), screenPoint, newZoom);
}

/** One zoom step around the centre of the viewport. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const newZoom = stepZoom(cam.zoom, direction);
  if (newZoom === cam.zoom) return cam;
  return anchorAt(screenToWorld(cam, centre), centre, newZoom);
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

/** The zoom level as a whole-number percentage (e.g. 1.5625 -> 156). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
