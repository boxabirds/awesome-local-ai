// Pure camera maths for the infinite board.
//
// Coordinate model:
// - World units are board coordinates; the origin (0,0) is the board's
//   starting point.
// - A `Camera` `{ x, y, zoom }` describes the world coordinate shown at the
//   top-left corner of the viewport (`x`, `y`) and the scale in screen
//   pixels per world unit (`zoom`).
// - `screen = (world - camera.xy) * zoom`;  `world = screen / zoom + camera.xy`
//
// All functions are pure and return a new `Camera`. When the result is
// identical to the input (limit reached, zero delta, invalid input) the
// *same object* is returned so React can skip re-rendering. No DOM, no React.

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

/** Multiplier that converts a zoom factor to a whole-number percentage. */
const PERCENT_SCALE = 100;

/**
 * Tolerance for snapping stepped zoom back onto the ZOOM_STEP_FACTOR^n
 * lattice so that a step in then a step out returns exactly to the start.
 */
const STEP_SNAP_EPSILON = 1e-9;

/** Convert a screen point (CSS px, viewport-relative) to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** Convert a world point to a screen point (CSS px, viewport-relative). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the board so content follows a pointer drag by (screenDx, screenDy)
 * CSS pixels. Returns the same object for a zero-length (or non-finite)
 * drag.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (
    (screenDx === 0 && screenDy === 0) ||
    !Number.isFinite(screenDx) ||
    !Number.isFinite(screenDy)
  ) {
    return cam;
  }
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` (> 0, finite) around a screen point, keeping the world
 * point under that screen point in place. The zoom is clamped to
 * [ZOOM_MIN, ZOOM_MAX]. An invalid factor (<= 0, NaN, ±Infinity) or a zoom
 * that would not change returns the input camera unchanged (same object).
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / newZoom,
    y: anchor.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom one step in or out around the centre of the viewport. Stepped zoom
 * snaps to the nearest ZOOM_STEP_FACTOR^n so that, e.g., a step in (x1.25)
 * followed by a step out (x0.8) returns exactly to the starting zoom
 * despite binary floating point.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const next = zoomAt(cam, centre, factor);
  if (next === cam) return next;
  const snapped = snapToStepLattice(next.zoom);
  if (snapped === next.zoom) return next;
  const anchor = screenToWorld(cam, centre);
  return {
    x: anchor.x - centre.x / snapped,
    y: anchor.y - centre.y / snapped,
    zoom: snapped,
  };
}

/** The standard view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

/** Whether a further zoom-in is possible. */
export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

/** Whether a further zoom-out is possible. */
export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Zoom as a whole-number percentage (nearest percent). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT_SCALE);
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * Return `zoom` snapped to the nearest ZOOM_STEP_FACTOR^n when it is within
 * STEP_SNAP_EPSILON of the lattice, otherwise return it unchanged.
 */
function snapToStepLattice(zoom: number): number {
  if (zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  return Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON ? snapped : zoom;
}
