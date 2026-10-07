import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from "../../shared/config";

/**
 * Board camera: world <-> screen maths.
 *
 * World units are board coordinates; (0,0) is the board's starting point.
 * The camera's `x, y` is the world coordinate shown at the top-left of the
 * board area and `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  = screen / zoom + camera.xy
 *
 * Every function is pure and returns a *new* Camera; when the result would be
 * identical to the input (limit reached, zero delta, invalid input) the input
 * object is returned unchanged so React can skip a render.
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

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Pan the board by a screen-space drag delta (or wheel delta). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!isFiniteNumber(screenDx) || !isFiniteNumber(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/** Zoom by `factor` keeping the world point under `screenPoint` fixed. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;
  if (!isFiniteNumber(screenPoint.x) || !isFiniteNumber(screenPoint.y)) return cam;

  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;

  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / newZoom,
    y: world.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: "in" | "out"): Camera {
  const factor = direction === "in" ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam;

  const snapped = snapToStep(stepped.zoom);
  if (snapped === stepped.zoom) return stepped;

  // Re-derive the camera from the pre-step world point so the centre of the
  // board area stays fixed under the snapped zoom too.
  const world = screenToWorld(cam, centre);
  return {
    x: world.x - centre.x / snapped,
    y: world.y - centre.y / snapped,
    zoom: snapped,
  };
}

/** Standard view: 100% zoom, board start point centred. */
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

// ---- internals -------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidFactor(factor: number): boolean {
  return isFiniteNumber(factor) && factor > 0;
}

/**
 * Stepped zoom must not drift: `ZOOM_STEP_FACTOR` then its inverse has to
 * return exactly the previous zoom (100% -> 125% -> 100%), so a stepped zoom
 * that sits within ZOOM_STEP_SNAP_EPSILON of a power of the step factor is
 * snapped to that power.
 */
function snapToStep(zoom: number): number {
  if (!isFiniteNumber(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const candidate = Math.pow(ZOOM_STEP_FACTOR, exponent);
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, candidate);
  return Math.abs(zoom - candidate) <= tolerance ? candidate : zoom;
}
