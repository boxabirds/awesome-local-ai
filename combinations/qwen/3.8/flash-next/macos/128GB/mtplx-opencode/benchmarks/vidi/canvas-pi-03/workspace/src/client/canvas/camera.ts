// Camera maths — pure functions, no DOM/React.
//
// Coordinate model (see design "Coordinate model"):
//   screen = (world - camera.xy) * zoom
//   world  = screen / zoom + camera.xy
// Camera {x, y, zoom}: x, y is the world coordinate shown at the viewport's
// top-left; zoom is screen pixels per world unit.
//
// Every function returns a NEW immutable Camera, or the *same* object when the
// result would be identical (limit reached / zero delta) so React can skip
// re-rendering. Invalid inputs return the input camera unchanged (never throw:
// input handlers must not be able to crash the board).

import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  ZOOM_SNAP_EPS,
  ZOOM_PERCENT_SCALE,
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A factor is only usable if it is a finite, strictly positive number. */
function validFactor(factor: number): boolean {
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
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  // Dragging the pointer right/down moves content right/down, so the world
  // coordinate at the viewport's top-left decreases.
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!validFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  // Keep the world point under the pointer fixed on screen.
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** Snap a zoom value to the nearest ZOOM_STEP_FACTOR^n when within epsilon, so
 * a step in then a step out lands exactly on 1.0 (TC-09). */
function snapZoom(z: number): number {
  const n = Math.round(Math.log(z) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  return Math.abs(snapped - z) < ZOOM_SNAP_EPS ? snapped : z;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  if (!validFactor(factor)) return cam;

  const rawZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (rawZoom === cam.zoom) return cam;

  // Snap kills float drift; re-clamp so a snap never crosses a limit.
  const snapped = snapZoom(rawZoom);
  let newZoom = snapped;
  if (newZoom !== rawZoom) newZoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;

  // Preserve the pointer invariant using the (possibly snapped) target zoom.
  const w = screenToWorld(cam, centre);
  return {
    x: w.x - centre.x / newZoom,
    y: w.y - centre.y / newZoom,
    zoom: newZoom,
  };
}

export function resetCamera(viewport: Size): Camera {
  // Put the world origin at the centre of the viewport at zoom 1.
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX - ZOOM_SNAP_EPS;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + ZOOM_SNAP_EPS;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * ZOOM_PERCENT_SCALE);
}