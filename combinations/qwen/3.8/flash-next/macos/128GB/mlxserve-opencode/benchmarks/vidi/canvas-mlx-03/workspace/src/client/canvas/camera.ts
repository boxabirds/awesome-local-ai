// Pure camera maths for the infinite board.
// No DOM, no React imports. See design "Camera maths" contract.

import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  PERCENT_PER_UNIT,
  ZOOM_STEP_SNAP_EPSILON,
  clamp,
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

/** A zoom factor is usable only if finite and strictly positive. */
function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/** Screen CSS pixels -> world units for the given camera. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  };
}

/** World units -> screen CSS pixels for the given camera. */
export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  };
}

/**
 * Pan by a screen-space delta. Content moves opposite the pointer, so the
 * camera's top-left world coordinate increases as the pointer moves down/right.
 * Zero delta returns the same object so React can skip re-render.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  const x = cam.x - screenDx / cam.zoom;
  const y = cam.y - screenDy / cam.zoom;
  return { x, y, zoom: cam.zoom };
}

/**
 * Zoom by `factor` keeping the world point under `screenPoint` pinned to the
 * same screen position. Clamped to [ZOOM_MIN, ZOOM_MAX]. Invalid factors and
 * already-at-limit results return the input camera unchanged (same object).
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  // Keep the world point under the pointer fixed.
  const wx = screenPoint.x / cam.zoom + cam.x;
  const wy = screenPoint.y / cam.zoom + cam.y;
  const x = wx - screenPoint.x / newZoom;
  const y = wy - screenPoint.y / newZoom;
  return { x, y, zoom: newZoom };
}

/**
 * Snap a zoom value to the nearest ZOOM_STEP_FACTOR^n when within epsilon, to
 * avoid float drift when stepping in then out.
 */
function snapZoom(zoom: number): number {
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const candidate = Math.pow(ZOOM_STEP_FACTOR, n);
  if (Math.abs(candidate - zoom) <= ZOOM_STEP_SNAP_EPSILON * Math.max(1, Math.abs(zoom))) {
    return candidate;
  }
  return zoom;
}

/**
 * One discrete zoom step around the viewport centre. `in` multiplies by
 * ZOOM_STEP_FACTOR, `out` divides. The result snaps to the nearest step value.
 * At a limit, returns the input camera unchanged (same object).
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam; // at limit
  const snapped = snapZoom(stepped.zoom);
  if (snapped === stepped.zoom) return stepped;
  // Re-anchor the pinned centre with the snapped zoom.
  const wx = centre.x / cam.zoom + cam.x;
  const wy = centre.y / cam.zoom + cam.y;
  const x = wx - centre.x / snapped;
  const y = wy - centre.y / snapped;
  return { x, y, zoom: snapped };
}

/** Standard view: zoom 1 with the world origin centred in the viewport. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Current zoom as a whole-number percentage (rounded). */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT_PER_UNIT);
}
