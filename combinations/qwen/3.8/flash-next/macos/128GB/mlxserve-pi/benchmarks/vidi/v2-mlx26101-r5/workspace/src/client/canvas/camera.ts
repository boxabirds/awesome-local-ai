/**
 * Pure camera maths for the infinite board.
 *
 * The camera is `{ x, y, zoom }` where `x, y` is the world coordinate shown at
 * the top-left of the viewport and `zoom` is screen pixels per world unit:
 *
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * Every function is pure and returns a new immutable Camera. When a mutation
 * would not change anything (limit reached, zero delta) the *same object* is
 * returned so React can skip a re-render. Invalid input never throws: the
 * input handlers must not be able to crash the board.
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

/** Converts a zoom level to the whole-number percentage shown in the UI. */
export const PERCENT_PER_ZOOM = 100;
/**
 * A stepped zoom is snapped back to the nearest exact power of
 * ZOOM_STEP_FACTOR when it is this close, so "zoom in then zoom out" lands on
 * exactly the zoom it started from instead of drifting by floating-point dust.
 */
export const STEP_SNAP_EPSILON = 1e-9;

const LOG_STEP_FACTOR = Math.log(ZOOM_STEP_FACTOR);

const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** True when a zoom level is a usable number (guards against NaN/Infinity). */
const isUsableZoom = (zoom: number): boolean => Number.isFinite(zoom) && zoom > 0;

/**
 * Snaps `zoom` to the nearest exact ZOOM_STEP_FACTOR^n when it is within
 * STEP_SNAP_EPSILON of one, so repeated steps do not accumulate error.
 */
function snapToStep(zoom: number): number {
  if (!isUsableZoom(zoom)) return zoom;
  const exponent = Math.round(Math.log(zoom) / LOG_STEP_FACTOR);
  const snapped = clampZoom(Math.pow(ZOOM_STEP_FACTOR, exponent));
  const tolerance = STEP_SNAP_EPSILON * Math.max(1, Math.abs(zoom));
  return Math.abs(snapped - zoom) <= tolerance ? snapped : zoom;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isUsableZoom(factor)) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  // Keep the world point under the screen point exactly where it is.
  const world = screenToWorld(cam, screenPoint);
  return { x: world.x - screenPoint.x / newZoom, y: world.y - screenPoint.y / newZoom, zoom: newZoom };
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const next = zoomAt(cam, centre, factor);
  if (next === cam) return cam;
  const snapped = snapToStep(next.zoom);
  if (snapped === next.zoom) return next;
  // Re-derive the position from the original camera so the centre of the board
  // area stays put under the snapped zoom.
  const world = screenToWorld(cam, centre);
  return { x: world.x - centre.x / snapped, y: world.y - centre.y / snapped, zoom: snapped };
}

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
