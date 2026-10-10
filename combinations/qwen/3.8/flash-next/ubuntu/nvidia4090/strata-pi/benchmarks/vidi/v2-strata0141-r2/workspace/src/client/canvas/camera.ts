import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_BASE,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/**
 * Board camera (pure maths, no DOM).
 *
 * `x, y` is the world coordinate shown at the top-left of the board area;
 * `zoom` is screen pixels per world unit.
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * Cameras are immutable: every helper returns a new Camera, or the *same
 * object* when nothing changed (so React can skip a re-render).
 */
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

const ONE_OVER_ZOOM_STEP_FACTOR = 1 / ZOOM_STEP_FACTOR;
const LOG_ZOOM_STEP_FACTOR = Math.log(ZOOM_STEP_FACTOR);

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
}

function isValidCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/** Screen (CSS pixels, relative to the board area) -> world units. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  };
}

/** World units -> screen (CSS pixels, relative to the board area). */
export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  };
}

/**
 * Move the board by the distance and direction the pointer moved. `x, y` are
 * unbounded doubles: the board has no edges.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!isValidCoordinate(screenDx) || !isValidCoordinate(screenDy)) {
    return cam;
  }
  if (screenDx === 0 && screenDy === 0) {
    return cam;
  }
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/** Apply an already-clamped zoom while keeping `screenPoint`'s world point fixed. */
function zoomTo(cam: Camera, screenPoint: Point, nextZoom: number): Camera {
  if (nextZoom === cam.zoom) {
    return cam;
  }
  const worldUnderPoint = screenToWorld(cam, screenPoint);
  return {
    x: worldUnderPoint.x - screenPoint.x / nextZoom,
    y: worldUnderPoint.y - screenPoint.y / nextZoom,
    zoom: nextZoom,
  };
}

/** Zoom by `factor` around a screen point, clamped to ZOOM_MIN..ZOOM_MAX. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) {
    return cam;
  }
  if (!isValidCoordinate(cam.x) || !isValidCoordinate(cam.y) || !isValidCoordinate(cam.zoom)) {
    return cam;
  }
  return zoomTo(cam, screenPoint, clampZoom(cam.zoom * factor));
}

/**
 * Snap a zoom to the nearest ZOOM_STEP_FACTOR^n when it is within
 * ZOOM_STEP_SNAP_EPSILON of it, so one step in then one step out returns the
 * starting zoom exactly instead of 1.0000000000000002.
 */
function snapToStepPower(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / LOG_ZOOM_STEP_FACTOR);
  if (!Number.isFinite(exponent)) {
    return zoom;
  }
  const snapped = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, zoom);
  return Math.abs(zoom - snapped) <= tolerance ? snapped : zoom;
}

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : ONE_OVER_ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  return zoomTo(cam, centre, clampZoom(snapToStepPower(cam.zoom * factor)));
}

/** Standard view: zoom 1 with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return {
    x: -viewport.width / 2,
    y: -viewport.height / 2,
    zoom: 1,
  };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * ZOOM_PERCENT_BASE);
}
