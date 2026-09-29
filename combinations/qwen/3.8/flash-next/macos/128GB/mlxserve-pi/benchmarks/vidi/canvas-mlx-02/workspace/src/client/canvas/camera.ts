// Pure camera maths. No DOM, no React imports.
//
// Coordinate model:
//   world units = board coordinates; origin (0,0) is the board's starting point.
//   Camera { x, y, zoom }: x, y are the world coordinate shown at the viewport
//   top-left; zoom is screen pixels per world unit.
//   screen = (world - camera.xy) * zoom
//   world  =  screen / zoom + camera.xy
//
// Every returned Camera is immutable. When a mutation would be a no-op (limit
// reached, zero delta, invalid factor) the *same input object* is returned so
// React can skip re-rendering.

import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  ZOOM_PERCENT_SCALE,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config.ts';

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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// A zoom factor is usable only if finite and strictly positive.
function isUsableFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
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

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isUsableFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  // Keep the world point under the pointer pinned to the same screen position.
  const wx = screenPoint.x / cam.zoom + cam.x;
  const wy = screenPoint.y / cam.zoom + cam.y;
  return { x: wx - screenPoint.x / newZoom, y: wy - screenPoint.y / newZoom, zoom: newZoom };
}

// Snap a zoom to the nearest exact power of ZOOM_STEP_FACTOR when it is within
// the epsilon band, so a step in then out lands on exactly 1.0.
function snapStep(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  // Relative epsilon so the band is meaningful at large and small zooms alike.
  if (Math.abs(zoom - snapped) <= ZOOM_STEP_SNAP_EPSILON * Math.abs(snapped)) {
    return snapped;
  }
  return zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const zoomed = zoomAt(cam, centre, factor);
  if (zoomed === cam) return cam; // hit a limit, keep same object identity
  const snapped = snapStep(zoomed.zoom);
  if (snapped === zoomed.zoom) return zoomed;
  return { x: zoomed.x, y: zoomed.y, zoom: snapped };
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
  return Math.round(cam.zoom * ZOOM_PERCENT_SCALE);
}
