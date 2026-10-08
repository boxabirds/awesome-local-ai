/**
 * Pure camera maths for the infinite board.
 *
 * Coordinate model:
 * - World units are board coordinates; the origin (0,0) is the board's
 *   starting point.
 * - A camera is `{ x, y, zoom }` where `x, y` is the world coordinate shown
 *   at the top-left of the viewport and `zoom` is screen pixels per world
 *   unit.
 * - `screen = (world - camera.xy) * zoom`; `world = screen / zoom + camera.xy`.
 *
 * No DOM, no React imports. All functions are pure and return a new
 * immutable Camera; if a mutation is a no-op (limit reached, zero delta,
 * invalid factor) the *same* camera object is returned so React can skip
 * re-rendering.
 */

import {
  PERCENT_PER_ZOOM,
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

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * Snap a step-zoom result to the nearest ZOOM_STEP_FACTOR^n when within
 * ZOOM_STEP_SNAP_EPSILON, so that e.g. stepping in then out returns exactly
 * 1.0 instead of drifting.
 */
function snapToStep(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  return Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON ? snapped : zoom;
}

/** Convert a screen-space point (CSS px, relative to the viewport top-left) to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** Convert a world point to screen-space coordinates (CSS px, relative to the viewport top-left). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the board by a screen-space delta: dragging the pointer (dx, dy) moves
 * the content by exactly (dx, dy), i.e. the camera moves by (-dx/zoom, -dy/zoom).
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) {
    return cam;
  }
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` (> 0) around a screen-space point, keeping the world
 * location under that point at the same screen position. Clamped to
 * [ZOOM_MIN, ZOOM_MAX]. Invalid factors (≤ 0, NaN, ±Infinity) return the
 * input camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) {
    return cam;
  }
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) {
    return cam;
  }
  const pointerWorld = screenToWorld(cam, screenPoint);
  return {
    x: pointerWorld.x - screenPoint.x / newZoom,
    y: pointerWorld.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Zoom one step (ZOOM_STEP_FACTOR, or its inverse) around the centre of the
 * viewport. Step results snap to the nearest ZOOM_STEP_FACTOR^n within
 * ZOOM_STEP_SNAP_EPSILON so that stepping in then out returns exactly.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const newZoom = snapToStep(clampZoom(cam.zoom * factor));
  if (newZoom === cam.zoom) {
    return cam;
  }
  const centreWorld = screenToWorld(cam, centre);
  return {
    x: centreWorld.x - centre.x / newZoom,
    y: centreWorld.y - centre.y / newZoom,
    zoom: newZoom,
  };
}

/** The standard view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

/** True if zooming one step in is possible (zoom < ZOOM_MAX). */
export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

/** True if zooming one step out is possible (zoom > ZOOM_MIN). */
export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** The zoom as a whole-number percentage (Math.round(zoom * PERCENT_PER_ZOOM)). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT_PER_ZOOM);
}
