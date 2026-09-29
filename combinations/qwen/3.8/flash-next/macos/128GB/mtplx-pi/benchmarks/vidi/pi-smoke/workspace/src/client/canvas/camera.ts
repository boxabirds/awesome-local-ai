// Pure camera maths. No DOM, no React. Immutable Camera.
// Coordinate model: camera { x, y, zoom } where (x, y) is the world coordinate
// shown at the viewport top-left and zoom is screen pixels per world unit.
//   screen = (world - camera.xy) * zoom
//   world  =  screen / zoom + camera.xy

import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  PERCENT_BASE,
  ZOOM_SNAP_EPSILON,
} from "@shared/config";

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

/**
 * Apply an exact new zoom, keeping the world point under `screenPoint` pinned.
 * Returns the input camera unchanged if the zoom is already `newZoom` (so React
 * can skip re-render) or if either value is non-finite.
 */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (!Number.isFinite(newZoom) || newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

function clampZoom(z: number): number {
  if (z < ZOOM_MIN) return ZOOM_MIN;
  if (z > ZOOM_MAX) return ZOOM_MAX;
  return z;
}

/** A factor is usable only when finite and strictly positive. */
function validFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!validFactor(factor)) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  return zoomTo(cam, screenPoint, newZoom);
}

/**
 * Snap a zoom to the nearest exact power of ZOOM_STEP_FACTOR when within
 * ZOOM_SNAP_EPSILON, so a zoom-in then zoom-out pair returns to the same value
 * with no float drift.
 */
function snapToStep(z: number): number {
  const n = Math.round(Math.log(z) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  if (Math.abs(snapped - z) <= ZOOM_SNAP_EPSILON) return snapped;
  return z;
}

function centre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: "in" | "out",
): Camera {
  const factor = direction === "in" ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStep(clampZoom(cam.zoom * factor));
  if (target === cam.zoom) return cam;
  return zoomTo(cam, centre(viewport), target);
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
  return Math.round(cam.zoom * PERCENT_BASE);
}
