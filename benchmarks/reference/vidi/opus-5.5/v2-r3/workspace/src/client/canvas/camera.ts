// Pure camera maths. No DOM, no React.
//
// Camera {x, y} is the world coordinate shown at the top-left of the viewport;
// zoom is screen pixels per world unit.
//   screen = (world - camera.xy) * zoom
//   world  = screen / zoom + camera.xy
import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
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

const HALF = 2;

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
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

/** Sets the zoom (clamped) keeping the world point under `screenPoint` fixed. */
function zoomTo(cam: Camera, screenPoint: Point, targetZoom: number): Camera {
  const newZoom = clampZoom(targetZoom);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

/** Snaps to the nearest ZOOM_STEP_FACTOR^n if within ZOOM_STEP_SNAP_EPSILON (relative). */
function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const candidate = ZOOM_STEP_FACTOR ** n;
  return Math.abs(zoom - candidate) <= ZOOM_STEP_SNAP_EPSILON * candidate ? candidate : zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre = { x: viewport.width / HALF, y: viewport.height / HALF };
  return zoomTo(cam, centre, snapToStep(cam.zoom * factor));
}

export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / HALF, y: -viewport.height / HALF, zoom: 1 };
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
