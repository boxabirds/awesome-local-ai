/**
 * Pure camera maths for the infinite board. No DOM, no React.
 *
 * Coordinate model:
 *  - World units: board coordinates; origin (0,0) is the board's starting
 *    point.
 *  - Camera { x, y, zoom }: x,y is the world coordinate shown at the
 *    top-left of the viewport; zoom is screen pixels per world unit.
 *  - screen = (world - camera.xy) * zoom
 *    world  = screen / zoom + camera.xy
 *
 * Every mutation returns a new immutable Camera. When the result would be
 * identical (limit reached, zero delta, invalid factor) the *same* object is
 * returned so React can skip the re-render.
 */
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from "../../shared/config";

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

/** Multiplier that turns a zoom factor into a percentage for display. */
const PERCENT_SCALE = 100;
/**
 * Absolute tolerance within which a stepped zoom is snapped to the nearest
 * power of ZOOM_STEP_FACTOR, so repeated in/out steps return to exact values
 * (1.25 * 0.8 must give exactly 1.0).
 */
const STEP_SNAP_EPSILON = 1e-9;

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Pan the camera by a screen-space delta (CSS pixels). Positive dx/dy means
 * the pointer moved right/down, so the world point at the top-left of the
 * viewport moves by -d/zoom. Zero delta returns the same object.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom by `factor` around a screen point, keeping the world point under that
 * point at the same screen position. The factor must be finite and > 0;
 * invalid factors return the input camera unchanged (input handlers must
 * never crash the board). Returns the same object when the zoom is unchanged
 * (limit reached or factor 1).
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / newZoom,
    y: anchor.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Snap `zoom` to the nearest power of ZOOM_STEP_FACTOR when within
 * STEP_SNAP_EPSILON, undoing float drift from repeated stepping.
 */
function snapToStep(zoom: number): number {
  const exponent = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const snapped = ZOOM_STEP_FACTOR ** Math.round(exponent);
  return Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON ? snapped : zoom;
}

/**
 * One zoom step in or out around the centre of the viewport, keeping the
 * board location at the centre at the same screen position.
 */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: "in" | "out",
): Camera {
  const factor = direction === "in" ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = clampZoom(snapToStep(cam.zoom * factor));
  if (target === cam.zoom) return cam;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const anchor = screenToWorld(cam, centre);
  return {
    x: anchor.x - centre.x / target,
    y: anchor.y - centre.y / target,
    zoom: target,
  };
}

/**
 * The standard view: 100% zoom centred on the board's starting point.
 */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Whole-number percentage for display, rounded to the nearest percent. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT_SCALE);
}
