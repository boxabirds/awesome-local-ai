// Pure camera maths for the infinite board. No DOM, no React.
//
// Coordinate model:
// - World units: board coordinates; (0,0) is the board's starting point.
// - Camera { x, y, zoom }: x, y is the world coordinate shown at the
//   top-left of the viewport; zoom is screen pixels per world unit.
// - screen = (world - camera.xy) * zoom
// - world  = screen / zoom + camera.xy

import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_SNAP_EPSILON,
  ZOOM_STEP_FACTOR,
} from '../../shared/config';

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

const LOG_STEP = Math.log(ZOOM_STEP_FACTOR);

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Snap a zoom to the nearest ZOOM_STEP_FACTOR^n when within the snap epsilon. */
function snapZoom(zoom: number): number {
  if (zoom === ZOOM_MIN || zoom === ZOOM_MAX) return zoom;
  const exponent = Math.round(Math.log(zoom) / LOG_STEP);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  return Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON ? snapped : zoom;
}

/** Convert a screen point (CSS px) to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** Convert a world point to screen coordinates (CSS px). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the camera by a screen-space delta. Content moves with the pointer:
 * a positive delta (pointer moves right/down) moves the camera left/up in
 * world space. A zero delta returns the same object.
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
 * Zoom by a factor around a screen point, keeping the world point under
 * that screen point fixed. The zoom is clamped to [ZOOM_MIN, ZOOM_MAX];
 * if the clamped zoom equals the current zoom the same object is returned.
 * An invalid factor (non-finite or <= 0) returns the input camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const worldPoint = screenToWorld(cam, screenPoint);
  return {
    x: worldPoint.x - screenPoint.x / newZoom,
    y: worldPoint.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom one step in or out around the centre of the viewport. The result is
 * snapped to the nearest ZOOM_STEP_FACTOR^n so repeated in/out steps return
 * exactly to the previous zoom.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const center: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const rawFactor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  let newZoom = clampZoom(cam.zoom * rawFactor);
  if (newZoom === cam.zoom) return cam;
  newZoom = snapZoom(newZoom);
  if (newZoom === cam.zoom) return cam;
  const worldPoint = screenToWorld(cam, center);
  return {
    x: worldPoint.x - center.x / newZoom,
    y: worldPoint.y - center.y / newZoom,
    zoom: newZoom,
  };
}

/** Camera showing 100% zoom centred on the board's starting point. */
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
