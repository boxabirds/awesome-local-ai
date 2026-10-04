import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';
import type { Point } from '../../shared/geometry';

// A point is a point, whether it is read off the screen or measured on the
// board; story 7 put the one definition in `shared/geometry` with the maths.
export type { Point };

/**
 * The camera describes what part of the (infinite) board is on screen.
 * `x, y` is the world coordinate shown at the top-left of the board area and
 * `zoom` is screen pixels per world unit. There is no clamping of `x`/`y`: the
 * board has no edges, and double precision keeps sub-pixel accuracy far beyond
 * UNBOUNDED_PAN_TESTED_EXTENT.
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Zoom percentages are whole hundredths. */
const PERCENT = 100;

/**
 * A zoom step that lands this close (absolute) to a power of ZOOM_STEP_FACTOR
 * snaps to it, so 100% -> 125% -> 100% is exact and has no float drift.
 */
const STEP_SNAP_EPSILON = 1e-9;

const LOG_STEP_FACTOR = Math.log(ZOOM_STEP_FACTOR);

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** A screen distance measured on the board: the pan drops out, the scale does not. */
export function screenDeltaToWorld(cam: Camera, delta: Point): Point {
  return { x: delta.x / cam.zoom, y: delta.y / cam.zoom };
}

/** A board distance as it appears on screen. */
export function worldDeltaToScreen(cam: Camera, delta: Point): Point {
  return { x: delta.x * cam.zoom, y: delta.y * cam.zoom };
}

/** Move the camera by a screen-space pointer/scroll delta (in CSS pixels). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom by `factor` keeping the world point under `screenPoint` at the same
 * screen position. Invalid factors (non-finite or <= 0) and zooming past a
 * limit return the input camera unchanged, so input handlers never crash and
 * React can skip re-renders on no-ops.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

/** One zoom step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  return zoomTo(cam, { x: viewport.width / 2, y: viewport.height / 2 }, snapToStep(cam.zoom * factor));
}

/** Apply an absolute zoom, clamped to the limits, keeping the screen point fixed. */
function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  // A factor so extreme that the product overflows still clamps to a limit.
  if (Number.isNaN(newZoom)) return cam;
  const zoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  if (zoom === cam.zoom) return cam;
  const world = screenToWorld(cam, screenPoint);
  return {
    x: world.x - screenPoint.x / zoom,
    y: world.y - screenPoint.y / zoom,
    zoom,
  };
}

/** The standard view: 100% zoom with the board's starting point centred. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** True when two cameras show exactly the same part of the board. */
export function sameCamera(a: Camera, b: Camera): boolean {
  return a === b || (a.x === b.x && a.y === b.y && a.zoom === b.zoom);
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Snap values that are within STEP_SNAP_EPSILON of ZOOM_STEP_FACTOR^n to it. */
function snapToStep(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / LOG_STEP_FACTOR);
  const nearest = Math.pow(ZOOM_STEP_FACTOR, exponent);
  return Math.abs(nearest - zoom) <= STEP_SNAP_EPSILON * Math.max(1, zoom) ? nearest : zoom;
}
