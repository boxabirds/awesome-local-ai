import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

/**
 * Immutable camera. `x, y` is the world coordinate shown at the top-left of
 * the board area; `zoom` is screen pixels per world unit. There is no
 * clamping on x/y: the board is unbounded (±UNBOUNDED_PAN_TESTED_EXTENT is
 * tested; doubles keep sub-pixel precision far beyond that).
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

/** A step result this close to ZOOM_STEP_FACTOR^n snaps to that exact power. */
const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Zoom factor to percent conversion. */
const PERCENT = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Snap to the nearest power of ZOOM_STEP_FACTOR when within the epsilon. */
function snapToStepZoom(zoom: number): number {
  const logBase = Math.log(ZOOM_STEP_FACTOR);
  const n = Math.round(Math.log(zoom) / logBase);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, snapped);
  return Math.abs(zoom - snapped) <= tolerance ? snapped : zoom;
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the board content by exactly (screenDx, screenDy) screen pixels.
 * A zero delta returns the *same object* so React can skip re-rendering.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Zoom around a screen point: the world location under `screenPoint` stays
 * at the same screen position. The new zoom is clamped to [ZOOM_MIN,
 * ZOOM_MAX]. Invalid input (non-finite or <= 0 factor, non-finite point) or
 * a zoom already at a limit returns the input camera unchanged (same object,
 * never throws: input handlers must never crash the board).
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return cam;
  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return { x: w.x - screenPoint.x / newZoom, y: w.y - screenPoint.y / newZoom, zoom: newZoom };
}

/**
 * One zoom step around the centre of the board area; the board location at
 * the centre stays at the same screen position. Step results are snapped to
 * exact powers of ZOOM_STEP_FACTOR so a step in followed by a step out
 * returns to exactly the previous zoom (no float drift).
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const stepFactor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const next = zoomAt(cam, centre, stepFactor);
  if (next === cam) return cam;
  const snappedZoom = snapToStepZoom(next.zoom);
  if (snappedZoom === next.zoom) return next;
  // Re-apply with the exact ratio so the returned zoom is exact and the
  // centre invariance is computed against the same zoom we return.
  const exact = zoomAt(cam, centre, snappedZoom / cam.zoom);
  return exact === cam ? cam : { ...exact, zoom: snappedZoom };
}

/** Standard view: 100% zoom with the board's starting point (0,0) centred. */
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
