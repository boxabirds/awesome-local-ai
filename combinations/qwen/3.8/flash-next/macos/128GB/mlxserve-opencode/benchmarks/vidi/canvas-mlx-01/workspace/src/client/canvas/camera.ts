import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config.js';

/**
 * Camera maths for the infinite board. Pure functions only: no DOM, no React.
 *
 * Coordinate model:
 * - World units are board coordinates; the origin (0,0) is the board's starting point.
 * - `x, y` is the world coordinate shown at the viewport top-left; `zoom` is screen
 *   pixels per world unit.
 * - `screen = (world - camera.xy) * zoom`, `world = screen / zoom + camera.xy`.
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

/** How close a stepped zoom must be to a `ZOOM_STEP_FACTOR^n` value to snap to it. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier turning a zoom factor into a percentage. */
export const PERCENT_PER_ZOOM = 100;

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Pan by a screen-space pointer delta. A zero delta returns the same object. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** How many `ZOOM_STEP_FACTOR` steps a zoom is away from 1. */
const STEP_LOG = Math.log(ZOOM_STEP_FACTOR);

/**
 * Snap a zoom to the nearest exact `ZOOM_STEP_FACTOR^n` when close enough, so that
 * a step in followed by a step out lands on exactly the same value (no float drift).
 */
const snapToStep = (zoom: number): number => {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / STEP_LOG);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  return Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON ? snapped : zoom;
};

/**
 * Set the zoom to `newZoom` keeping the world point under `screenPoint` fixed.
 * `newZoom` must be finite and inside the limits; equal zoom returns the input.
 */
const zoomTo = (cam: Camera, screenPoint: Point, newZoom: number): Camera => {
  if (newZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / newZoom,
    y: anchor.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
};

/**
 * Zoom by `factor` keeping the world point under `screenPoint` fixed.
 * Invalid factors (<= 0, NaN, +/- Infinity) return the input camera unchanged;
 * reaching a limit returns the input camera so React can skip a re-render.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  return zoomTo(cam, screenPoint, clampZoom(cam.zoom * factor));
}

/** One zoom step around the centre of the viewport. */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const raw = cam.zoom * factor;
  if (!Number.isFinite(raw) || raw <= 0) return cam;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  // Snapping keeps the step ladder on exact powers of ZOOM_STEP_FACTOR, so one
  // step in followed by one step out lands on exactly the same zoom.
  const target = snapToStep(clampZoom(raw));
  return zoomTo(cam, centre, target);
}

/** 100% zoom with the board's starting point (world 0,0) centred in the viewport. */
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
