// Pure camera maths for the infinite board. No DOM, no React.
//
// Coordinate model:
// - World units: board coordinates; (0,0) is the board's starting point.
// - Camera { x, y, zoom }: x,y is the world coordinate shown at the
//   top-left of the viewport; zoom is screen pixels per world unit.
// - screen = (world - camera.xy) * zoom; world = screen / zoom + camera.xy.
//
// All functions are pure and return a new Camera, except that a no-op
// (limit reached, zero delta, invalid input) returns the *same* object so
// React can skip re-rendering.

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

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

/** Relative tolerance for snapping a stepped zoom to ZOOM_STEP_FACTOR^n. */
export const STEP_SNAP_EPSILON = 1e-9;
/** Scaling factor from a 1.0 zoom to a 100% label. */
const PERCENT = 100;

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the board by a screen-space delta. Content moves by exactly the
 * delta; the camera (world point at the top-left) shifts by -delta/zoom.
 * Camera x,y are unbounded, so panning has no edges.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * Zoom around a screen point: the world location under the point stays at
 * the same screen position. The factor is clamped to [ZOOM_MIN, ZOOM_MAX];
 * an invalid factor (non-finite or <= 0) returns the input unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Snap a stepped zoom to the nearest ZOOM_STEP_FACTOR^n when within
 * STEP_SNAP_EPSILON (relative), so 1.25 in then out returns exactly 1.0.
 */
function snapStepZoom(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  if (Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON * zoom) return snapped;
  return zoom;
}

/**
 * Zoom one step (ZOOM_STEP_FACTOR in, its inverse out) around the centre
 * of the viewport, so the board location at the centre stays put.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const next = zoomAt(cam, centre, factor);
  if (next === cam) return cam;
  const snappedZoom = snapStepZoom(next.zoom);
  if (snappedZoom === next.zoom) return next;
  const w = screenToWorld(cam, centre);
  return { x: w.x - centre.x / snappedZoom, y: w.y - centre.y / snappedZoom, zoom: snappedZoom };
}

/** Standard view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Current zoom as a whole-number percentage (e.g. 1.5625 -> 156). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
