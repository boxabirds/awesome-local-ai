// src/client/canvas/camera.ts
// Pure camera maths — no DOM, no React imports.

import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../shared/config';

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

const PERCENT = 100;
const STEP_SNAP_EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Convert a screen-space point to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  };
}

/** Convert a world-space point to screen coordinates. */
export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  };
}

/** Pan the camera by a screen-space delta. Returns the same object if delta is zero. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom at a screen-space point by a factor.
 * The world point under the screen point stays fixed.
 * Returns the same object if the factor is invalid, clamped to same zoom, or factor is 1.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Reject invalid factors
  if (!Number.isFinite(factor) || factor <= 0) return cam;

  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;

  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom by one step around the centre of the viewport.
 * Snaps to the nearest ZOOM_STEP_FACTOR^n to avoid float drift.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const result = zoomAt(cam, centre, factor);

  // Snap to nearest ZOOM_STEP_FACTOR^n to avoid float drift
  if (result !== cam) {
    const snapped = snapZoom(result.zoom);
    if (Math.abs(snapped - result.zoom) > STEP_SNAP_EPSILON) {
      // Re-compute position with the snapped zoom to keep centre fixed
      const w = screenToWorld(cam, centre);
      return {
        x: w.x - centre.x / snapped,
        y: w.y - centre.y / snapped,
        zoom: snapped,
      };
    }
  }

  return result;
}

/** Snap a zoom value to the nearest ZOOM_STEP_FACTOR^n. */
function snapZoom(zoom: number): number {
  // zoom = ZOOM_STEP_FACTOR^n => n = log(zoom) / log(ZOOM_STEP_FACTOR)
  const n = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const rounded = Math.round(n);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, rounded);
  if (Math.abs(snapped - zoom) <= 1e-6) return snapped;
  return zoom;
}

/** Reset the camera to 100% zoom centred on the board's starting point. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

/** Whether the camera can zoom in further. */
export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX - 1e-9;
}

/** Whether the camera can zoom out further. */
export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + 1e-9;
}

/** The zoom level as a whole-number percentage. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
