// Pure camera maths for the infinite board (see spec: camera.math).
//
// Coordinate model:
// - World units: board coordinates; (0,0) is the board's starting point.
// - Camera { x, y, zoom }: x,y is the world coordinate shown at the top-left
//   of the viewport; zoom is screen pixels per world unit.
// - screen = (world - camera.xy) * zoom;  world = screen / zoom + camera.xy
//
// No DOM, no React. Every mutation returns a new immutable Camera; if the
// result would be identical (limit reached, zero delta, invalid factor) the
// *same object* is returned so React can skip a re-render.

import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
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

const ZOOM_STEP_FACTOR_INVERSE = 1 / ZOOM_STEP_FACTOR;

/** Map a screen-space point (CSS px from the viewport top-left) to world units. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** Map a world point to screen space (CSS px from the viewport top-left). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the camera by a screen-space delta (CSS px). Content follows the
 * pointer: dragging the board right/down moves the camera left/up in world.
 * A zero delta returns the same object.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by a positive factor around a screen point, keeping the world point
 * under that screen point fixed. The zoom is clamped to [ZOOM_MIN, ZOOM_MAX].
 * An invalid factor (non-finite or <= 0) returns the input camera unchanged.
 * If the clamped zoom equals the current zoom, the same object is returned.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

/**
 * Zoom one step (ZOOM_STEP_FACTOR in, its inverse out) around the viewport
 * centre. The resulting zoom is snapped to the nearest ZOOM_STEP_FACTOR^n
 * when within ZOOM_STEP_SNAP_EPSILON, so stepping in then out returns exactly
 * to the previous value (no float drift).
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : ZOOM_STEP_FACTOR_INVERSE;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam;
  const snappedZoom = snapToStepZoom(stepped.zoom);
  if (snappedZoom === stepped.zoom) return stepped;
  const w = screenToWorld(cam, centre);
  return { x: w.x - centre.x / snappedZoom, y: w.y - centre.y / snappedZoom, zoom: snappedZoom };
}

/** 100% zoom centred on the board's starting point (world origin). */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Whole-number percentage for the zoom label. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Snap a zoom value to the nearest ZOOM_STEP_FACTOR^n if within epsilon. */
function snapToStepZoom(zoom: number): number {
  const step = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const nearest = Math.round(step);
  if (Math.abs(step - nearest) <= ZOOM_STEP_SNAP_EPSILON) {
    return Math.pow(ZOOM_STEP_FACTOR, nearest);
  }
  return zoom;
}
