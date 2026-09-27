import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_SCALE,
  ZOOM_STEP_FACTOR,
  ZOOM_STEP_SNAP_EPSILON,
} from '../../shared/config';

/**
 * Pure camera maths for the infinite board (design "camera.math").
 *
 * A camera is `{ x, y, zoom }` where `x, y` is the world coordinate shown at
 * the top-left of the board area and `zoom` is screen pixels per world unit.
 *
 *   screen = (world - camera.xy) * zoom
 *   world  =  screen / zoom      + camera.xy
 *
 * No DOM, no React. Every function returns a new immutable camera, or the
 * *same* object when nothing would change (limit reached, zero delta, invalid
 * input) so React can skip the re-render. Nothing here ever throws: an input
 * handler must never be able to crash the board.
 *
 * Doubles keep sub-pixel precision far beyond +/-1,000,000 world units at
 * ZOOM_MAX, so no re-basing of the origin is needed for the tested extent.
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

/** Move the camera by a pointer movement given in screen pixels. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

/**
 * Zoom by `factor`, keeping the board location under `screenPoint` at the same
 * screen position. The factor is clamped to the zoom limits; a factor that is
 * not a positive finite number is ignored (the input camera comes back).
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  return zoomTo(cam, screenPoint, clampZoom(cam.zoom * factor));
}

/**
 * One zoom step (the + / - buttons and Ctrl/Cmd + = / -) around the centre of
 * the board area. The result snaps onto the exact `ZOOM_STEP_FACTOR^n` ladder,
 * so a step in followed by a step out returns precisely the zoom it started
 * from instead of drifting.
 */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const stepped =
    direction === 'in' ? cam.zoom * ZOOM_STEP_FACTOR : cam.zoom / ZOOM_STEP_FACTOR;
  return zoomTo(cam, centre(viewport), clampZoom(snapToLadder(stepped)));
}

/** Standard view: 100% with the board's starting point at the centre. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** The zoom as a whole-number percentage, e.g. 1.5625 -> 156. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * ZOOM_PERCENT_SCALE);
}

function zoomTo(cam: Camera, screenPoint: Point, newZoom: number): Camera {
  if (!Number.isFinite(newZoom) || newZoom <= 0) return cam;
  if (newZoom === cam.zoom) return cam;
  // Keep the world point under the pointer exactly where it is.
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / newZoom,
    y: anchor.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_MAX;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Nearest exact power of ZOOM_STEP_FACTOR, if `zoom` is within the epsilon. */
function snapToLadder(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  const tolerance = ZOOM_STEP_SNAP_EPSILON * Math.max(1, Math.abs(zoom));
  return Math.abs(snapped - zoom) <= tolerance ? snapped : zoom;
}

function centre(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}
