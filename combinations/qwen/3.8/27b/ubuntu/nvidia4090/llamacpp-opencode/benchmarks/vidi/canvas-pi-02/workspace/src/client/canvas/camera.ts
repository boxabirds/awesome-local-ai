import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model:
 *  - World units: board coordinates; (0,0) is the board's starting point.
 *  - Camera { x, y, zoom }: `x, y` is the world coordinate shown at the
 *    top-left of the viewport; `zoom` is screen pixels per world unit.
 *  - screen = (world - camera.xy) * zoom
 *  - world  = screen / zoom + camera.xy
 *
 * All functions are pure and return immutable Cameras. When a call is a
 * no-op (zero delta, limit reached, invalid factor) the *same* camera
 * object is returned so React can skip the re-render.
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

/** Zoom of the "home" (reset) view: 100%. */
const ZOOM_HOME = 1;
/** 100, for `zoomPercent`. */
const PERCENT = 100;
/**
 * A stepped zoom is snapped to the nearest ZOOM_STEP_FACTOR power when it
 * lies within this distance, so "in then out" returns exactly the previous
 * value despite binary floating point (e.g. 1.25 * 0.8).
 */
const STEP_SNAP_EPSILON = 1e-9;

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/**
 * Pan the camera so the world follows the pointer by (screenDx, screenDy)
 * CSS pixels. A zero delta returns the same object.
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
 * Zoom by `factor` (> 0, finite) keeping the world point under `screenPoint`
 * fixed. Clamps to [ZOOM_MIN, ZOOM_MAX]; an invalid factor or a no-op zoom
 * (already at the limit) returns the same object.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** Snap to the nearest ZOOM_STEP_FACTOR power when within STEP_SNAP_EPSILON. */
function snapToStep(zoom: number): number {
  const exponent = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, Math.round(exponent));
  return Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON ? snapped : zoom;
}

/**
 * Zoom one step (ZOOM_STEP_FACTOR, or its inverse) around the centre of the
 * viewport. The result snaps to an exact ZOOM_STEP_FACTOR power when close
 * enough, so stepping in and out round-trips exactly.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam;
  const newZoom = snapToStep(stepped.zoom);
  if (newZoom === stepped.zoom) return stepped;
  // Re-anchor so the viewport centre stays fixed under the snapped zoom.
  const w = screenToWorld(cam, centre);
  return {
    x: w.x - centre.x / newZoom,
    y: w.y - centre.y / newZoom,
    zoom: newZoom,
  };
}

/** Reset: 100% zoom, the board's starting point centred in the viewport. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: ZOOM_HOME };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Whole-number percentage for display (e.g. 156 for 1.5625). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
