// Pure camera maths for the infinite board. No DOM, no React imports.
//
// Coordinate model:
// - World units: board coordinates; the origin (0,0) is the board's starting point.
// - Camera { x, y, zoom }: x, y is the world coordinate shown at the top-left of the
//   viewport; zoom is screen pixels per world unit.
// - screen = (world - camera.xy) * zoom;  world = screen / zoom + camera.xy.
//
// Contract:
// - All functions return a new immutable Camera, except that when the result would be
//   identical (limit reached, zero delta, invalid input) the *same* input object is
//   returned so React can skip the re-render.
// - Invalid zoom factors (non-finite or <= 0) never throw: the input camera is returned
//   unchanged so input handlers can never crash the board.

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

/** Multiplier for whole-number percentages. */
const PERCENT = 100;
/** Tolerance for snapping a stepped zoom to the nearest ZOOM_STEP_FACTOR^n. */
const STEP_SNAP_EPSILON = 1e-9;

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

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Convert a screen-space point (CSS pixels, viewport-relative) to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** Convert a world point to screen coordinates (CSS pixels, viewport-relative). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the camera so the board content moves by (screenDx, screenDy) screen pixels.
 * There is no clamping on x/y: the board is unbounded (pan.unbounded).
 * Returns the same object for a zero (or non-finite) delta.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom by `factor` (> 0) around `screenPoint`, keeping the world point under the
 * pointer at the same screen position. Clamped to ZOOM_MIN..ZOOM_MAX.
 * Invalid factors (non-finite or <= 0) return the input camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  // Keep the world point under the pointer fixed:
  //   w = screenToWorld(cam, p);  x = w.x - p.x / newZoom
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Snap a zoom produced by stepping to the nearest ZOOM_STEP_FACTOR^n when it is
 * within STEP_SNAP_EPSILON of one, so repeated in/out steps do not drift
 * (e.g. 1 -> 1.25 -> exactly 1).
 */
function snapSteppedZoom(zoom: number): number {
  const exponent = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const candidate = ZOOM_STEP_FACTOR ** Math.round(exponent);
  return Math.abs(candidate - zoom) <= STEP_SNAP_EPSILON ? candidate : zoom;
}

/**
 * Zoom one step (ZOOM_STEP_FACTOR in, or its inverse out) around the centre of the
 * viewport. The board location at the centre stays at the same screen position.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam;
  const snappedZoom = snapSteppedZoom(stepped.zoom);
  if (snappedZoom === stepped.zoom) return stepped;
  // Re-anchor around the centre for the snapped zoom.
  const w = screenToWorld(cam, centre);
  return {
    x: w.x - centre.x / snappedZoom,
    y: w.y - centre.y / snappedZoom,
    zoom: snappedZoom,
  };
}

/** The standard view: 100% zoom, board starting point (world 0,0) centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Current zoom as a whole-number percentage. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
