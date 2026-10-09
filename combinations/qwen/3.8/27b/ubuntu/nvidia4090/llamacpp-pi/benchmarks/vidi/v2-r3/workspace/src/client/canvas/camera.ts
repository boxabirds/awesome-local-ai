/**
 * Pure camera maths: world <-> screen transforms, pan, zoom-at-point, clamping.
 *
 * World units are board coordinates; camera { x, y, zoom } where x, y is the
 * world coordinate shown at the top-left of the viewport and zoom is screen
 * pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom + camera.xy
 */
import {
  ZOOM_MAX,
  ZOOM_MIN,
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

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Snap near values of ZOOM_STEP_FACTOR^n to the exact power so that stepping
 * in and out returns exactly (no float drift).
 */
function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  if (Math.abs(snapped - zoom) <= 1e-9 * Math.max(1, zoom)) return snapped;
  return zoom;
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  if (!isValidFactor(factor)) return cam;
  const newZoom = snapToStep(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  if (newZoom === cam.zoom) return cam;
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const w = screenToWorld(cam, center);
  return { x: w.x - center.x / newZoom, y: w.y - center.y / newZoom, zoom: newZoom };
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
  return Math.round(cam.zoom * 100);
}
