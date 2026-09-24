/**
 * Pure camera maths for the infinite board. No DOM, no React.
 *
 * World units: board coordinates, origin (0,0) is the board's starting point.
 * Camera {x, y, zoom}: (x, y) is the world coordinate at the viewport's top-left
 * corner; zoom is screen pixels per world unit.
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * Every function returns the *same object* when nothing would change so React
 * can skip re-rendering and callers can detect no-ops by identity.
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }
export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }

/** Zoom 1 == 100%. */
const PERCENT = 100;
/** Step zoom snaps to ZOOM_STEP_FACTOR^n when this close, to avoid float drift. */
const STEP_SNAP_EPSILON = 1e-9;
const RESET_ZOOM = 1;
const HALF = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Moves the board content by (screenDx, screenDy) CSS pixels. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/** Sets the zoom to `newZoom` (clamped) keeping the world point under `screenPoint` fixed. */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  const zoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  if (zoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / zoom, y: w.y - screenPoint.y / zoom, zoom };
}

/** Multiplies the zoom by `factor` around `screenPoint`. Invalid factors are ignored. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

function snapToStepLevel(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const level = Math.pow(ZOOM_STEP_FACTOR, n);
  return Math.abs(level - zoom) <= STEP_SNAP_EPSILON ? level : zoom;
}

/** One zoom step in or out around the centre of the viewport. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStepLevel(clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  const centre = { x: viewport.width / HALF, y: viewport.height / HALF };
  return zoomTo(cam, centre, target);
}

/** 100% zoom with the board's starting point centred in the viewport. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / HALF, y: -viewport.height / HALF, zoom: RESET_ZOOM };
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
