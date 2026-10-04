import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../shared/config';

/**
 * Pure camera maths for the infinite board.
 *
 * A {@link Camera} describes the viewport: `x, y` is the world coordinate
 * shown at the top-left of the viewport, and `zoom` is screen pixels per world
 * unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom + camera.xy
 *
 * All functions are pure and immutable. When a mutation would produce an
 * identical camera (a limit was reached, a zero delta, or invalid input) the
 * *same* object is returned so React can skip a re-render and so the
 * `hasNavigated` latch stays untripped. Invalid input (non-finite or out-of-range
 * zoom factors) returns the input camera unchanged; the board never crashes on
 * bad gesture values.
 *
 * There is no clamping on `x`/`y`, so the user can pan arbitrarily far
 * (>= UNBOUNDED_PAN_TESTED_EXTENT) without hitting an edge. Doubles keep
 * sub-pixel precision at that distance even at ZOOM_MAX.
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

/** Tolerance used to snap stepped zoom values onto the ZOOM_STEP_FACTOR ladder. */
const ZOOM_SNAP_EPSILON = 1e-9;
/** Tolerance for comparing zoom against the limits in canZoomIn/Out. */
const ZOOM_LIMIT_EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Snap a raw stepped zoom onto the nearest ZOOM_STEP_FACTOR^n, if very close. */
function snapToStepLadder(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** n;
  return Math.abs(zoom - snapped) < ZOOM_SNAP_EPSILON ? snapped : zoom;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/** Zoom so that the world point under `screenPoint` stays fixed at `newZoom`. */
function zoomAtToZoom(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (!Number.isFinite(newZoom) || newZoom <= 0) return cam;
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  return zoomAtToZoom(cam, screenPoint, newZoom);
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const raw =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  const target = clamp(snapToStepLadder(raw), ZOOM_MIN, ZOOM_MAX);
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  return zoomAtToZoom(cam, centre, target);
}

export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX - ZOOM_LIMIT_EPSILON;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + ZOOM_LIMIT_EPSILON;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
