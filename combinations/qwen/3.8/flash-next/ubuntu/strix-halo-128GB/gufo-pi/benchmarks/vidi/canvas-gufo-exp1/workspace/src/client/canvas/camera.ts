/**
 * Pure camera maths: world <-> screen transforms, pan, zoom-at-point and clamping.
 *
 * Coordinate model:
 *  - World units are board coordinates; (0,0) is the board's starting point.
 *  - `Camera.x`/`y` is the world coordinate shown at the viewport top-left;
 *    `Camera.zoom` is screen pixels per world unit.
 *  - screen = (world - camera.xy) * zoom;  world = screen / zoom + camera.xy.
 *
 * No DOM, no React. Every function returns a new `Camera`, or the *same* object when
 * nothing would change, so React can skip a re-render.
 */
import {
  PERCENT_SCALE,
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

export type ZoomDirection = 'in' | 'out';

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** A factor is usable only when it is a finite, strictly positive number. */
const isUsableFactor = (factor: number): boolean => Number.isFinite(factor) && factor > 0;

/** Snap a zoom that came from repeated multiplication to its exact step value. */
const snapToStep = (zoom: number): number => {
  const exponent = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = ZOOM_STEP_FACTOR ** exponent;
  return Math.abs(snapped - zoom) <= ZOOM_STEP_SNAP_EPSILON ? snapped : zoom;
};

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Move the camera by a pointer/scroll delta given in screen pixels. */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/** Zoom to an absolute zoom keeping `screenPoint`'s board location fixed. */
const zoomTo = (cam: Camera, screenPoint: Point, newZoom: number): Camera => {
  if (!Number.isFinite(newZoom) || newZoom <= 0) return cam;
  const clamped = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  if (clamped === cam.zoom) return cam;
  const anchor = screenToWorld(cam, screenPoint);
  return {
    x: anchor.x - screenPoint.x / clamped,
    y: anchor.y - screenPoint.y / clamped,
    zoom: clamped,
  };
};

/**
 * Zoom by `factor` keeping the board location under `screenPoint` at the same
 * screen position. Clamps to [ZOOM_MIN, ZOOM_MAX]; invalid factors are ignored.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isUsableFactor(factor)) return cam;
  return zoomTo(cam, screenPoint, cam.zoom * factor);
}

/** Zoom one step around the centre of the viewport, snapped to exact step values. */
export function zoomStep(cam: Camera, viewport: Size, direction: ZoomDirection): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  return zoomTo(cam, { x: viewport.width / 2, y: viewport.height / 2 }, snapToStep(cam.zoom * factor));
}

/** Standard view: 100% zoom with the board's starting point centred. */
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
  return Math.round(cam.zoom * PERCENT_SCALE);
}
