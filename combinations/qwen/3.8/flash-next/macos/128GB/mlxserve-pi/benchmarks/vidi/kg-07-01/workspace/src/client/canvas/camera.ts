// Pure camera maths: world <-> screen transforms, pan, zoom-at-point, clamping.
// No DOM or React imports.
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

/** `x, y` is the world coordinate at the viewport's top-left; `zoom` is screen px per world unit. */
export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }
export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }

/** Step zooms within this distance of ZOOM_STEP_FACTOR^n snap to it, avoiding float drift. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Multiplier converting zoom to a percentage. */
export const PERCENT = 100;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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

function zoomTo(cam: Camera, screenPoint: Point, targetZoom: number): Camera {
  const newZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  return Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON ? snapped : zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  return zoomTo(cam, centre, snapToStep(cam.zoom * factor));
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
  return Math.round(cam.zoom * PERCENT);
}
