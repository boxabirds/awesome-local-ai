// Pure camera maths for the board. See camera.math contract.
//
// Coordinate model:
//   world units  -> board coordinates; origin (0,0) is the board start point.
//   camera       -> { x, y, zoom } where (x, y) is the world coordinate shown at
//                    the viewport top-left and zoom is screen px per world unit.
//   screen = (world - camera.xy) * zoom ; world = screen / zoom + camera.xy.
//
// Every mutation returns a NEW immutable Camera, or the SAME object when nothing
// would change, so React can skip re-renders. No DOM, no React imports.

import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
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

const PERCENT_SCALE = 100;

/**
 * Zoom values this close (relative) to a whole power of ZOOM_STEP_FACTOR are
 * snapped to it, so a step out after a step in returns exactly the original zoom
 * (1.25 then /1.25 must be exactly 1.0, not 1.0000000000000002).
 */
const STEP_SNAP_EPSILON = 1e-9;

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Snap a zoom to the nearest power of ZOOM_STEP_FACTOR if very close. */
function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const power = Math.pow(ZOOM_STEP_FACTOR, n);
  const tolerance = STEP_SNAP_EPSILON * Math.max(1, Math.abs(zoom));
  return Math.abs(power - zoom) <= tolerance ? power : zoom;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Set the zoom to `newZoom` while keeping the world point under `screenPoint`
 * at the same screen position. Assumes newZoom is already clamped and finite.
 */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

export function zoomAt(
  cam: Camera,
  screenPoint: Point,
  factor: number,
): Camera {
  // Invalid factors must never crash the board: return the camera untouched.
  if (!isFiniteNumber(factor) || factor <= 0) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  return zoomTo(cam, screenPoint, newZoom);
}

export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const base =
    direction === 'in'
      ? cam.zoom * ZOOM_STEP_FACTOR
      : cam.zoom / ZOOM_STEP_FACTOR;
  const desired = clamp(snapToStep(base), ZOOM_MIN, ZOOM_MAX);
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  return zoomTo(cam, centre, desired);
}

export function resetCamera(viewport: Size): Camera {
  // Zoom 100% with the board's starting point (world 0,0) at the centre.
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT_SCALE);
}
