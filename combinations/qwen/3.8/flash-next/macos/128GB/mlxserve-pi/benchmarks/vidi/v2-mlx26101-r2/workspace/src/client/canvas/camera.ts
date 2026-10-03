/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model (design "Coordinate model"):
 * - World units are board coordinates; the origin (0,0) is the board's starting
 *   point. The camera's `x, y` is the world coordinate shown at the top-left of
 *   the viewport and `zoom` is screen pixels per world unit.
 * - screen = (world - camera.xy) * zoom; world = screen / zoom + camera.xy.
 *
 * The camera is immutable: every function returns a *new* camera, or the very
 * same object when nothing would change, so React can skip re-rendering.
 * There is no clamping on x/y, so the board is unbounded (pan.unbounded).
 *
 * No DOM and no React in this module.
 */

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config.js';

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

/** Zoom levels are snapped to ZOOM_STEP_FACTOR^n within this relative window. */
export const STEP_SNAP_RELATIVE_EPSILON = 1e-9;

/** Zoom (per second of wheel delta) is reported to users as a percentage. */
const PERCENT = 100;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

/** The point in the middle of the viewport, in screen pixels. */
export const viewportCentre = (viewport: Size): Point => ({
  x: viewport.width / 2,
  y: viewport.height / 2,
});

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan by a screen-space drag: the board content moves with the pointer, so the
 * camera's world position moves by the opposite of the drag divided by zoom.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom around a screen point, keeping the world location under that point at
 * the same screen position. Invalid factors (<= 0, NaN, Infinity) are ignored.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isPositiveFinite(factor) || !Number.isFinite(cam.zoom)) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return { x: world.x - screenPoint.x / newZoom, y: world.y - screenPoint.y / newZoom, zoom: newZoom };
}

/**
 * Snap a zoom level to the nearest exact power of ZOOM_STEP_FACTOR when it is
 * within STEP_SNAP_RELATIVE_EPSILON of it, so a step in followed by a step out
 * returns exactly the zoom it started from (no float drift across the ladder).
 */
export function snapToStep(zoom: number): number {
  if (!isPositiveFinite(zoom)) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  if (Math.abs(snapped - zoom) <= STEP_SNAP_RELATIVE_EPSILON * Math.max(1, zoom)) return snapped;
  return zoom;
}

/** Zoom one step in or out around the centre of the viewport. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStep(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  if (target === cam.zoom || !isPositiveFinite(target)) return cam;
  // Derive the position from the snapped target zoom (rather than multiplying
  // cam.zoom by a factor) so the resulting zoom is exact and the viewport
  // centre keeps the same world location.
  const centre = viewportCentre(viewport);
  const world = screenToWorld(cam, centre);
  return { x: world.x - centre.x / target, y: world.y - centre.y / target, zoom: target };
}

/** The standard view: 100% zoom with the board's starting point centred. */
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
