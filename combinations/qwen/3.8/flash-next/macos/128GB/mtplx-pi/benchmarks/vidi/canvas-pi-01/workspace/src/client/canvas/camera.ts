/**
 * Pure camera maths (see design "Camera maths").
 *
 * A Camera is `{ x, y, zoom }` where `x, y` is the world coordinate shown at
 * the top-left of the viewport and `zoom` is screen pixels per world unit.
 *
 * `screen = (world - camera.xy) * zoom`; `world = screen / zoom + camera.xy`.
 *
 * No DOM, no React: everything here is pure and testable in node. Every
 * mutation returns a *new* camera, or the *same* object when nothing would
 * change, so React can skip re-renders (and the navigation hint can latch on
 * object identity).
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

/**
 * Zoom levels produced by zoomStep snap to `ZOOM_STEP_FACTOR^n` when they are
 * within this relative tolerance of one, so that one step in followed by one
 * step out returns the bit-identical zoom level instead of drifting.
 */
const ZOOM_SNAP_TOLERANCE = 1e-9;

/** Zoom-to-percent scale (zoom 1 is shown as "100%"). */
const PERCENT = 100;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * `ZOOM_STEP_FACTOR^n` computed as 5^n / 4^n with exact integer arithmetic
 * for the |n| reachable between ZOOM_MIN and ZOOM_MAX, avoiding the drift a
 * chain of `* 1.25` / `/ 1.25` operations would accumulate.
 */
function powerOfStep(n: number): number {
  const abs = Math.abs(n);
  let num = 1;
  let den = 1;
  for (let i = 0; i < abs; i++) {
    num *= 5;
    den *= 4;
  }
  return n >= 0 ? num / den : den / num;
}

/** Snap a zoom value to the nearest step ladder rung, if it is close enough. */
function snapToStepLadder(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = powerOfStep(n);
  if (!Number.isFinite(snapped) || snapped < ZOOM_MIN || snapped > ZOOM_MAX) return zoom;
  return Math.abs(snapped - zoom) <= ZOOM_SNAP_TOLERANCE * zoom ? snapped : zoom;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the camera so content follows the pointer by `screenDx, screenDy`
 * CSS pixels. A zero-length drag returns the same camera object.
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
 * Set the zoom to `newZoom` while keeping the world point currently under
 * `screenPoint` under `screenPoint`.
 */
function zoomToZoom(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom around a screen point. An invalid factor (not finite, or <= 0) leaves
 * the camera unchanged: input handlers must never be able to crash the board.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  return zoomToZoom(cam, screenPoint, clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
}

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const target =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  return zoomToZoom(cam, centre, snapToStepLadder(clamp(target, ZOOM_MIN, ZOOM_MAX)));
}

/** 100% zoom with the board's starting point (world 0,0) centred. */
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