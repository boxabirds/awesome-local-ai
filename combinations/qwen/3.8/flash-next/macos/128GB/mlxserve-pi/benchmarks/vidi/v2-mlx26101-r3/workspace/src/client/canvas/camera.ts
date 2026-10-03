import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/**
 * The camera describes what part of the board is on screen.
 * `x`, `y` is the world coordinate shown at the top-left of the viewport;
 * `zoom` is screen pixels per world unit.
 *
 * Coordinates: `screen = (world - camera.xy) * zoom`, `world = screen / zoom + camera.xy`.
 * `x` and `y` are unbounded doubles, so the board has no edges: the user can pan at
 * least UNBOUNDED_PAN_TESTED_EXTENT world units from the start in any direction and
 * doubles keep sub-pixel precision out there.
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

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Move the camera by the inverse of a screen-space pointer/scroll delta. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  const dx = normalizeDelta(screenDx);
  const dy = normalizeDelta(screenDy);
  if (dx === 0 && dy === 0) {
    return cam;
  }
  return { x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` keeping the world point under `screenPoint` unmoved.
 * The result is clamped to [ZOOM_MIN, ZOOM_MAX]; invalid factors (<= 0, NaN,
 * infinite) and no-ops return the input camera object unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) {
    return cam;
  }
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

/** Zoom so the world point under `screenPoint` stays put and the zoom becomes `target`. */
function zoomTo(cam: Camera, screenPoint: Point, target: number): Camera {
  if (!Number.isFinite(target)) {
    return cam;
  }
  const zoom = clamp(target, ZOOM_MIN, ZOOM_MAX);
  if (zoom === cam.zoom) {
    return cam;
  }
  const anchor = screenToWorld(cam, screenPoint);
  return { x: anchor.x - screenPoint.x / zoom, y: anchor.y - screenPoint.y / zoom, zoom };
}

/**
 * Zoom one ZOOM_STEP_FACTOR in or out around the centre of the board area.
 * The target zoom snaps to the nearest ZOOM_STEP_FACTOR^n so that a step in
 * followed by a step out returns to exactly the zoom it started from.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStep(cam.zoom * factor);
  return zoomTo(cam, centreOf(viewport), target);
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

function centreOf(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

function normalizeDelta(delta: number): number {
  return Number.isFinite(delta) ? delta : 0;
}

const LOG_STEP = Math.log(ZOOM_STEP_FACTOR);

/** Snap a zoom that is within ZOOM_STEP_SNAP_EPSILON of ZOOM_STEP_FACTOR^n to it. */
function snapToStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return zoom;
  }
  const snapped = Math.pow(ZOOM_STEP_FACTOR, Math.round(Math.log(zoom) / LOG_STEP));
  const epsilon = ZOOM_STEP_SNAP_EPSILON * Math.max(1, Math.abs(snapped));
  return Math.abs(snapped - zoom) <= epsilon ? snapped : zoom;
}
