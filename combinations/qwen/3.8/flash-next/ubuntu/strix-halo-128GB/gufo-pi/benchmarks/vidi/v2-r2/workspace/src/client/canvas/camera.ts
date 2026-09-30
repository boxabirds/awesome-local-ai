// Pure camera maths: world <-> screen transforms, pan, zoom-at-point, clamping.
// No DOM, no React. See design camera.math contract.

import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '@shared/config';

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

// Whole-percent conversion (100 is a named constant, not a bare literal).
const PERCENT = 100;

// Step-snapping tolerance: 1.25 then its inverse must return exactly 1.0.
const STEP_SNAP_EPS = 1e-9;

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

// Apply an exact target zoom while keeping the world point under `screenPoint`
// pinned to the same screen position. Returns the input camera if the clamped
// zoom equals the current zoom (so React can skip a re-render).
function withZoom(cam: Camera, screenPoint: Point, targetZoom: number): Camera {
  if (!Number.isFinite(targetZoom)) return cam;
  const nextZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
  if (nextZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / nextZoom,
    y: w.y - screenPoint.y / nextZoom,
    zoom: nextZoom,
  };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Invalid factor (<=0, NaN, +/-Infinity) -> input camera unchanged, never throw.
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  return withZoom(cam, screenPoint, cam.zoom * factor);
}

// Snap a zoom value to the nearest power of ZOOM_STEP_FACTOR when it is within
// STEP_SNAP_EPS, so a step in immediately followed by a step out lands exactly.
function snapToStepPower(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  return Math.abs(zoom - snapped) <= STEP_SNAP_EPS ? snapped : zoom;
}

export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const base = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapToStepPower(cam.zoom * base);
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  return withZoom(cam, centre, target);
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
