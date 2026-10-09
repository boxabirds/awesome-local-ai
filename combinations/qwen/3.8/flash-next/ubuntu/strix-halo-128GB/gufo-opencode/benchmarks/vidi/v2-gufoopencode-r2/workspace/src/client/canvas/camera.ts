// Pure camera maths: world <-> screen transforms, pan, zoom-at-point, clamping.
// No DOM, no React. See design "Camera maths" for the contract.

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
const LIMIT_EPSILON = 1e-12;
// Step zoom snaps to the nearest ZOOM_STEP_FACTOR^n within this, so
// one step in then one step out returns exactly the previous zoom.
const STEP_SNAP_EPSILON = 1e-9;

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

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  return Math.abs(zoom - snapped) < STEP_SNAP_EPSILON ? snapped : zoom;
}

// Keeps the world point under `screenPoint` at the same screen position for the
// target zoom. Assumes zoomed !== cam.zoom.
function zoomTo(cam: Camera, screenPoint: Point, zoomed: number): Camera {
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / zoomed, y: w.y - screenPoint.y / zoomed, zoom: zoomed };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  return zoomTo(cam, screenPoint, newZoom);
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const newZoom = clampZoom(snapToStep(cam.zoom * factor));
  if (newZoom === cam.zoom) return cam;
  return zoomTo(cam, centre, newZoom);
}

export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX - LIMIT_EPSILON;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + LIMIT_EPSILON;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
