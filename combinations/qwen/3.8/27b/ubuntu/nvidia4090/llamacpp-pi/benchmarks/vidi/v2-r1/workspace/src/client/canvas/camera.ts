// Pure camera maths for the infinite board (story 1, camera.math contract).
// No DOM, no React: world units are board coordinates; the camera's (x, y) is
// the world coordinate shown at the top-left of the viewport, and `zoom` is
// screen pixels per world unit.

import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
  PERCENT_PER_UNIT,
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

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor));
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** Snap a zoom value to the nearest ZOOM_STEP_FACTOR^n when close enough, so that
 *  stepping in and out returns exact values (no float drift). */
function snapToStep(zoom: number): number {
  const n = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const candidate = ZOOM_STEP_FACTOR ** Math.round(n);
  if (Math.abs(candidate - zoom) <= ZOOM_STEP_SNAP_EPSILON * Math.max(1, zoom)) {
    return candidate;
  }
  return zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const target = snapToStep(
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor)),
  );
  if (target === cam.zoom) return cam;
  const w = screenToWorld(cam, centre);
  return {
    x: w.x - centre.x / target,
    y: w.y - centre.y / target,
    zoom: target,
  };
}

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
  return Math.round(cam.zoom * PERCENT_PER_UNIT);
}
