import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }
export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }

const PERCENT = 100;
const STEP_SNAP_EPSILON = 1e-9;
const HALF = 2;

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { ...cam, x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom };
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

function zoomTo(cam: Camera, p: Point, targetZoom: number): Camera {
  const newZoom = clampZoom(targetZoom);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, p);
  return { x: w.x - p.x / newZoom, y: w.y - p.y / newZoom, zoom: newZoom };
}

function validFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!validFactor(factor)) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  const target = cam.zoom * factor;
  if (!Number.isFinite(target)) return cam;
  return zoomTo(cam, screenPoint, target);
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  let target = cam.zoom * factor;
  const n = Math.log(target) / Math.log(ZOOM_STEP_FACTOR);
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) < STEP_SNAP_EPSILON) target = Math.pow(ZOOM_STEP_FACTOR, nearest);
  const centre = { x: viewport.width / HALF, y: viewport.height / HALF };
  return zoomTo(cam, centre, target);
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
