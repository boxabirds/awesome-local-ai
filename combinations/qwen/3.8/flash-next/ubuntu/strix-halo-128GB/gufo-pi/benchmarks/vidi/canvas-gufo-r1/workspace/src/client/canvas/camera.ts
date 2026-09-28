// Pure camera maths for the infinite board.
// No DOM, no React. See design "Camera maths" (anchor: camera.math).
//
// Coordinate model:
//   Camera { x, y, zoom }: x,y is the world coordinate shown at the viewport
//   top-left; zoom is screen pixels per world unit.
//     screen = (world - camera.xy) * zoom
//     world  = screen / zoom + camera.xy

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

export type ZoomDirection = 'in' | 'out';

/** Convert a fractional zoom to a whole-number percentage. */
const PERCENT = 100;

/** Snap tolerance for stepping so 1.25 then 0.8 returns exactly 1.0. */
const ZOOM_SNAP_EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/** Snap a zoom to the nearest ZOOM_STEP_FACTOR^n when it is that close. */
function snapToStep(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  return Math.abs(snapped - zoom) < ZOOM_SNAP_EPSILON ? snapped : zoom;
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

/**
 * Zoom by `factor`, keeping the world point under `screenPoint` fixed on screen.
 * Invalid factors (<=0, NaN, +-Infinity) return `cam` unchanged. If the clamped
 * zoom equals the current zoom, `cam` is returned unchanged (same object).
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom one step around the centre of `viewport`. Snaps the resulting zoom to the
 * nearest ZOOM_STEP_FACTOR^n so a step in followed by a step out is exact.
 */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: ZoomDirection,
): Camera {
  const factor =
    direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const rawTarget = snapToStep(cam.zoom * factor);
  const target = clamp(rawTarget, ZOOM_MIN, ZOOM_MAX);
  if (target === cam.zoom) return cam;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const w = screenToWorld(cam, centre);
  return {
    x: w.x - centre.x / target,
    y: w.y - centre.y / target,
    zoom: target,
  };
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
