import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/**
 * Pure camera maths. `x, y` is the world coordinate shown at the viewport
 * top-left; `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * No DOM, no React, no side effects. Every function returns a new immutable
 * Camera, or the *same* object when nothing changed (so React can skip renders).
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A point in screen space (CSS pixels) or world space (board units). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type ZoomDirection = 'in' | 'out';

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const isUsableCamera = (cam: Camera): boolean =>
  isFiniteNumber(cam.x) && isFiniteNumber(cam.y) && isFiniteNumber(cam.zoom) && cam.zoom > 0;

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Pan by a screen-space delta (the distance the pointer moved). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!isUsableCamera(cam)) {
    return cam;
  }
  if (!isFiniteNumber(screenDx) || !isFiniteNumber(screenDy)) {
    return cam;
  }
  if (screenDx === 0 && screenDy === 0) {
    return cam;
  }
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom by `factor` while keeping the world point under `screenPoint` at the
 * same screen position. Clamped to [ZOOM_MIN, ZOOM_MAX]; invalid factors
 * (<= 0, NaN, ±Infinity) leave the camera unchanged.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isUsableCamera(cam)) {
    return cam;
  }
  if (!isFiniteNumber(factor) || factor <= 0) {
    return cam;
  }
  if (!isFiniteNumber(screenPoint.x) || !isFiniteNumber(screenPoint.y)) {
    return cam;
  }
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) {
    return cam;
  }
  const world = screenToWorld(cam, screenPoint);
  const next: Camera = {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
  if (next.x === cam.x && next.y === cam.y && next.zoom === cam.zoom) {
    return cam;
  }
  return next;
}

/**
 * Snap a zoom to the nearest power of ZOOM_STEP_FACTOR when it is close enough,
 * so one step in followed by one step out returns exactly the starting zoom.
 */
const snapZoom = (zoom: number): number => {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const candidate = clamp(ZOOM_STEP_FACTOR ** exponent, ZOOM_MIN, ZOOM_MAX);
  if (Math.abs(candidate - zoom) <= ZOOM_STEP_SNAP_EPSILON * Math.max(1, zoom)) {
    return candidate;
  }
  return zoom;
};

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) {
    return cam;
  }
  const snapped = snapZoom(stepped.zoom);
  if (snapped === stepped.zoom) {
    return stepped;
  }
  // Keep the centre point fixed with the snapped zoom.
  const world = screenToWorld(cam, centre);
  return { x: world.x - centre.x / snapped, y: world.y - centre.y / snapped, zoom: snapped };
}

/** 100% zoom with the board's starting point (world 0,0) centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return isUsableCamera(cam) && cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return isUsableCamera(cam) && cam.zoom > ZOOM_MIN;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}

/** The centre of the board area, in screen coordinates. */
export function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}
