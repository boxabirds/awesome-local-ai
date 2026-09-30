// Pure camera maths: world <-> screen transforms, pan, zoom-at-point, clamping.
// No DOM, no React imports. See the story 1 technical design for the contract.
//
// Coordinate model
//   world units  : board coordinates; (0, 0) is the board's starting point.
//   camera       : { x, y, zoom } where (x, y) is the world coordinate shown at
//                  the top-left of the board area and `zoom` is screen pixels per
//                  world unit.
//   screen = (world - camera.xy) * zoom
//   world  =  screen / zoom + camera.xy

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
export type ZoomDirection = 'in' | 'out';

/** Zoom -> percentage label multiplier. */
export const PERCENT = 100;

/**
 * A stepped zoom within this distance of an exact `ZOOM_STEP_FACTOR^n` snaps to
 * it, so a step in followed by a step out returns to exactly 1.0 and repeated
 * stepping does not accumulate floating-point drift.
 */
export const STEP_SNAP_EPSILON = 1e-9;

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Centre of the board area in screen coordinates. */
export function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** A usable zoom factor: finite and strictly positive. */
function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/**
 * Move the camera by a screen-space pointer delta: the board content follows
 * the pointer exactly. A zero-length delta returns the same object.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom around a screen point: the world location under that point stays at the
 * same screen position. Clamped to [ZOOM_MIN, ZOOM_MAX]; invalid factors and
 * clamped no-ops return the input camera object unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Snap a zoom to the nearest exact power of ZOOM_STEP_FACTOR when it is within
 * STEP_SNAP_EPSILON of it, cancelling float drift from repeated stepping.
 */
function snapToStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = STEP_SNAP_EPSILON * Math.max(1, Math.abs(zoom));
  return Math.abs(snapped - zoom) <= tolerance ? snapped : zoom;
}

/**
 * One zoom step around the centre of the board area: the board location at the
 * centre stays at the same screen position, and the zoom snaps to the exact
 * step value so steps are reversible (1.0 -> 1.25 -> 1.0 exactly).
 */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre = viewportCentre(viewport);
  const next = zoomAt(cam, centre, factor);
  if (next === cam) return cam;
  const snapped = snapToStep(next.zoom);
  if (snapped === next.zoom) return next;
  // Recompute the camera so the world point at the centre stays put.
  const world = screenToWorld(cam, centre);
  return { x: world.x - centre.x / snapped, y: world.y - centre.y / snapped, zoom: snapped };
}

/** Reset view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** The whole-number percentage shown in the zoom control. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
