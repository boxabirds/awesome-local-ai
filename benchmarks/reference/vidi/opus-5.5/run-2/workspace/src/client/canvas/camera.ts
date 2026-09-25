/**
 * Pure camera maths for the infinite board (anchor: camera.math).
 *
 * World units are board coordinates; (0,0) is the board's starting point.
 * Camera {x, y} is the world coordinate shown at the viewport's top-left corner and
 * `zoom` is screen pixels per world unit:
 *   screen = (world - camera.xy) * zoom;   world = screen / zoom + camera.xy
 *
 * Every function is side-effect free. When a mutation would not change anything
 * (limit reached, zero delta, invalid input) the *same* camera object is returned so
 * React can skip the re-render and callers can detect "nothing happened".
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }
export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }

/** Multiplier from zoom to the displayed percentage. */
const PERCENT = 100;
/** Relative distance within which a stepped zoom snaps to an exact ZOOM_STEP_FACTOR^n. */
const STEP_SNAP_EPSILON = 1e-9;
const HALF = 2;
const DEFAULT_ZOOM = 1;

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Moves the content by (screenDx, screenDy) CSS pixels. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Sets an absolute zoom, keeping the world point under `screenPoint` fixed on screen. */
function zoomToAt(cam: Camera, screenPoint: Point, targetZoom: number): Camera {
  const newZoom = clampZoom(targetZoom);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

/** Multiplies the zoom by `factor` around `screenPoint`, clamped to the zoom limits. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  return zoomToAt(cam, screenPoint, cam.zoom * factor);
}

/** Snaps to the nearest exact ZOOM_STEP_FACTOR^n when floating-point drift put us next to it. */
function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** n;
  return Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON * zoom ? snapped : zoom;
}

/** One zoom step in or out around the centre of the viewport. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / HALF, y: viewport.height / HALF };
  return zoomToAt(cam, centre, snapToStep(cam.zoom * factor));
}

/** 100% zoom with the board's starting point in the centre of the viewport. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / HALF, y: -viewport.height / HALF, zoom: DEFAULT_ZOOM };
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
