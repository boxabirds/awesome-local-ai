// Pure camera maths for the infinite board (story 1). See design.md "Camera maths".
// No DOM, no React: every function is pure and returns a new immutable Camera
// (the *same* object when nothing would change, so React can skip re-rendering).
// An invalid zoom factor never throws: input handlers must not crash the board.
import {
  PERCENT,
  ZOOM_LIMIT_EPSILON,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from "../../shared/config";

/** Camera: `x, y` is the world coordinate shown at the viewport top-left; `zoom` is screen pixels per world unit. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A point in screen (CSS pixel) or world space, depending on context. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A size in CSS pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

/** Centre of the board area, in screen coordinates. */
export function viewportCentre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the board by a screen-space pointer delta. A zero-length drag returns the
 * same object so callers can skip work (and the navigation hint stays visible).
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom by `factor` keeping the board location under `screenPoint` at the same
 * screen position. Clamped to [ZOOM_MIN, ZOOM_MAX]; returns `cam` unchanged when
 * the zoom would not move or `factor` is not a finite positive number.
 */
export function zoomAt(
  cam: Camera,
  screenPoint: Point,
  factor: number,
): Camera {
  if (!isValidFactor(factor)) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y))
    return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / newZoom,
    y: anchor.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/**
 * Step zooms multiply/divide by `ZOOM_STEP_FACTOR`, which drifts in binary
 * floating point (1.25 * 0.8 !== 1). Snap back onto the nearest power of the
 * step factor when the result is within `ZOOM_STEP_SNAP_EPSILON` of it, so an
 * in-then-out pair lands on exactly the zoom it started from.
 */
function snapToStepGrid(zoom: number): number {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  return Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON ? snapped : zoom;
}

/** Zoom one step around the centre of the board area. */
export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: "in" | "out",
): Camera {
  const factor = direction === "in" ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre = viewportCentre(viewport);
  const stepped = zoomAt(cam, centre, factor);
  if (stepped === cam) return cam;
  const zoom = snapToStepGrid(stepped.zoom);
  if (zoom === stepped.zoom) return stepped;
  // Re-anchor on the same viewport centre with the snapped zoom.
  const anchor = screenToWorld(cam, centre);
  return { x: anchor.x - centre.x / zoom, y: anchor.y - centre.y / zoom, zoom };
}

/** The standard view: 100% with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX - ZOOM_LIMIT_EPSILON;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + ZOOM_LIMIT_EPSILON;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
