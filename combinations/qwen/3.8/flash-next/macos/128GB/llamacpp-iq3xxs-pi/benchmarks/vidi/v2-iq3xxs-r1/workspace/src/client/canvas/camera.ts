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

export type ZoomDirection = 'in' | 'out';

const PERCENT = 100;
/** Relative tolerance for snapping a stepped zoom to ZOOM_STEP_FACTOR^n. */
const STEP_SNAP_RELATIVE_EPSILON = 1e-9;

function clampZoom(value: number): number {
  // Math.min/max collapse NaN -> handled by callers; here value is finite.
  return Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX);
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/**
 * Snap a value to the nearest exact ZOOM_STEP_FACTOR^n when it is within
 * tolerance, so repeated steps do not drift (1.25 -> 1.0 comes back exactly).
 */
function snapToStepPower(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const n = Math.round(Math.log(value) / Math.log(ZOOM_STEP_FACTOR));
  const candidate = Math.pow(ZOOM_STEP_FACTOR, n);
  const tolerance = STEP_SNAP_RELATIVE_EPSILON * Math.max(1, Math.abs(value));
  return Math.abs(candidate - value) <= tolerance ? candidate : value;
}

/** Set the zoom to newZoomRaw (clamped) while keeping the world point under `point` fixed. */
function zoomAtZoom(cam: Camera, point: Point, newZoomRaw: number): Camera {
  const newZoom = clampZoom(newZoomRaw);
  // Returning the *same object* lets React skip a re-render (and keeps the hint).
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, point);
  return {
    x: w.x - point.x / newZoom,
    y: w.y - point.y / newZoom,
    zoom: newZoom,
  };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam; // non-finite or <= 0 -> input unchanged, never crashes
  return zoomAtZoom(cam, screenPoint, cam.zoom * factor);
}

export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const raw =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  return zoomAtZoom(cam, centre, snapToStepPower(raw));
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
