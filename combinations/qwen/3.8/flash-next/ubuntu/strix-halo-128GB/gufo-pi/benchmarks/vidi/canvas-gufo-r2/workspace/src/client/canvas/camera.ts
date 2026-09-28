import {
  PERCENT_PER_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/**
 * Pure camera maths. No DOM, no React.
 *
 * `x, y` is the world coordinate shown at the top-left of the viewport;
 * `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom + camera.xy
 *
 * Every function is pure and immutable: it returns a *new* Camera, or the very
 * same object when nothing would change, so React can skip re-renders. Invalid
 * input (non-finite or non-positive zoom factors) returns the input camera
 * instead of throwing — input handlers must never crash the board.
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
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

/** Apply an already-decided zoom, keeping the world point under `screenPoint` fixed. */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (newZoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return { x: world.x - screenPoint.x / newZoom, y: world.y - screenPoint.y / newZoom, zoom: newZoom };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  return zoomTo(cam, screenPoint, clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
}

/**
 * Zooms one step about the centre of the viewport. The result snaps to the
 * nearest exact `ZOOM_STEP_FACTOR^n` so "step in, step out" lands back on the
 * zoom it started from (1 -> 1.25 -> 1 exactly) instead of drifting.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const raw = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  return zoomTo(cam, centre, snapToStepLadder(raw));
}

const LOG_STEP_FACTOR = Math.log(ZOOM_STEP_FACTOR);

function snapToStepLadder(zoom: number): number {
  const steps = Math.round(Math.log(zoom) / LOG_STEP_FACTOR);
  const snapped = Math.exp(steps * LOG_STEP_FACTOR);
  if (Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON * Math.max(1, zoom)) return snapped;
  return zoom;
}

/** Standard view: 100% zoom with the board's starting point (world 0,0) centred. */
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
