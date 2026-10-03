/**
 * Pure camera maths for the infinite board. No DOM, no React.
 *
 * World units are board coordinates; the origin (0,0) is the board's starting
 * point. A camera `{ x, y, zoom }` means: world point (x, y) is shown at the
 * top-left of the viewport, and `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * All functions are pure and return a new Camera. When the result would be
 * identical to the input (limit reached, zero delta, invalid factor) the
 * *same object* is returned so React can skip the re-render.
 */

import {
  PERCENT,
  STEP_SNAP_EPSILON,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_RESET,
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

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Convert a screen point (CSS px) to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** Convert a world point to screen coordinates (CSS px). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the camera by a screen-space delta. The board (and the grid) moves by
 * exactly the distance and direction the pointer moved. Zero delta returns
 * the same object.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom around a screen point by `factor`, keeping the world point under the
 * pointer at the same screen position. Clamps to the zoom limits; an invalid
 * factor (non-finite or <= 0) returns the input camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * One zoom button/key step around the centre of the viewport. Snaps the
 * result to the nearest ZOOM_STEP_FACTOR^n so 1.0 → 1.25 → 0.8 returns
 * exactly 1.0 (no float drift).
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  return snapToStep(zoomAt(cam, centre, factor));
}

function snapToStep(cam: Camera): Camera {
  if (cam.zoom === ZOOM_MIN || cam.zoom === ZOOM_MAX) return cam;
  const n = Math.log(cam.zoom) / Math.log(ZOOM_STEP_FACTOR);
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) > STEP_SNAP_EPSILON) return cam;
  const snapped = Math.pow(ZOOM_STEP_FACTOR, nearest);
  if (Math.abs(snapped - cam.zoom) > STEP_SNAP_EPSILON) return cam;
  return { x: cam.x, y: cam.y, zoom: snapped };
}

/** The standard view: 100% zoom, board starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: ZOOM_RESET };
}

/** True when a further zoom-in is possible. */
export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

/** True when a further zoom-out is possible. */
export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** The zoom level as a whole-number percentage for display. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
