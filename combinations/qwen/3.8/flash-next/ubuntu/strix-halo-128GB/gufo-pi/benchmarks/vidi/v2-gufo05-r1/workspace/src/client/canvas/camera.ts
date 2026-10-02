/**
 * Pure camera maths for the infinite board.
 *
 * World units are board coordinates; the world origin (0,0) is the board's
 * starting point. A camera is `{ x, y, zoom }` where `x, y` is the world
 * coordinate shown at the top-left of the viewport and `zoom` is screen pixels
 * per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom + camera.xy
 *
 * Camera positions are unbounded doubles: there is no clamp on `x`/`y`, so the
 * board has no edges, and doubles keep sub-pixel precision far beyond
 * UNBOUNDED_PAN_TESTED_EXTENT even at ZOOM_MAX.
 *
 * No DOM, no React: everything here is pure so it can be unit tested directly.
 * Every function returns a *new* immutable Camera, or the input camera itself
 * when nothing would change, so React can skip re-renders.
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

export interface Camera {
  /** World coordinate shown at the left edge of the viewport. */
  readonly x: number;
  /** World coordinate shown at the top edge of the viewport. */
  readonly y: number;
  /** Screen pixels per world unit. */
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

/** Turns a zoom into a whole-number percentage. */
const PERCENT = 100;

/** How close a stepped zoom must be to `ZOOM_STEP_FACTOR^n` to snap to it. */
export const STEP_SNAP_EPSILON = 1e-9;

function isUsableFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Move the camera by the inverse of a screen-space pointer delta. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` keeping the board location under `screenPoint` at the same
 * screen position. Invalid factors (<= 0, NaN, +/-Infinity) leave the camera
 * untouched so input handling can never crash the board.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isUsableFactor(factor)) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

/** `zoomAt` with the requested target zoom already computed. */
function zoomTo(cam: Camera, screenPoint: Point, requestedZoom: number): Camera {
  if (!Number.isFinite(requestedZoom)) return cam;
  const newZoom = clampZoom(requestedZoom);
  if (newZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return { x: anchor.x - screenPoint.x / newZoom, y: anchor.y - screenPoint.y / newZoom, zoom: newZoom };
}

function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

/** The nearest value of `ZOOM_STEP_FACTOR^n` to `zoom`. */
function nearestStepZoom(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  return Math.pow(ZOOM_STEP_FACTOR, exponent);
}

/** True when `zoom` sits (almost) exactly on a step value. */
function isOnStep(zoom: number): boolean {
  if (!Number.isFinite(zoom) || zoom <= 0) return false;
  const step = nearestStepZoom(zoom);
  return Math.abs(zoom - step) <= STEP_SNAP_EPSILON * Math.max(1, step);
}

/**
 * Zoom one step around the centre of the board area. Stepping repeatedly would
 * drift in floating point (1.25 * 0.8 !== 1), so when both the current zoom and
 * the raw target sit on a step value the target snaps to `ZOOM_STEP_FACTOR^n`.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const rawTarget =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  const target = isOnStep(cam.zoom) && isOnStep(rawTarget) ? nearestStepZoom(rawTarget) : rawTarget;
  return zoomTo(cam, viewportCentre(viewport), target);
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
