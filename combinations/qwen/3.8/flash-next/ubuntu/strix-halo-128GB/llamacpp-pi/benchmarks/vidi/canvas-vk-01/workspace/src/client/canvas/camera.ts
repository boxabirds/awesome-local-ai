// Camera maths: pure world <-> screen transforms for the infinite board.
// x, y is the world coordinate shown at the top-left of the viewport;
// zoom is screen pixels per world unit.
//
// screen = (world - camera.xy) * zoom
// world  =  screen / zoom + camera.xy
//
// Doubles keep sub-pixel precision far beyond +/- UNBOUNDED_PAN_TESTED_EXTENT at
// ZOOM_MAX, so no re-basing of the origin is needed.
//
// Every function is pure and immutable: a mutation that would change nothing
// returns the *same object* so React can skip re-rendering. An invalid input
// (non-finite, or a zoom factor <= 0) returns the input camera instead of
// throwing, because input handlers must never crash the board.

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../shared/config';

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

/** 1 as a percentage, for zoomPercent. */
const PERCENT = 100;
/**
 * A zoom value this close to ZOOM_STEP_FACTOR^n is treated as that value, so
 * stepping in and out cannot accumulate floating point drift (TC-09).
 */
const ZOOM_SNAP_EPSILON = 1e-9;

const LOG_STEP = Math.log(ZOOM_STEP_FACTOR);

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Snap to the nearest ZOOM_STEP_FACTOR^n when (numerically) on one. */
function snapZoom(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) return zoom;
  const snapped = Math.pow(ZOOM_STEP_FACTOR, Math.round(Math.log(zoom) / LOG_STEP));
  if (
    Math.abs(snapped - zoom) <= ZOOM_SNAP_EPSILON &&
    snapped >= ZOOM_MIN &&
    snapped <= ZOOM_MAX
  ) {
    return snapped;
  }
  return zoom;
}

/**
 * Replace the zoom while keeping the world point under `anchor` on screen at the
 * same place. Returns the input camera when the zoom does not change.
 */
function withZoomAt(cam: Camera, zoom: number, anchor: Point): Camera {
  if (zoom === cam.zoom) return cam;
  const world = screenToWorld(cam, anchor);
  return { x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom, zoom };
}

function centreOf(viewport: Size): Point {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/**
 * Move the board by a pointer movement given in screen pixels: the content
 * follows the pointer exactly, whatever the zoom.
 */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (!Number.isFinite(screenDx) || !Number.isFinite(screenDy)) return cam;
  if (screenDx === 0 && screenDy === 0) return cam;
  return { x: cam.x - screenDx / cam.zoom, y: cam.y - screenDy / cam.zoom, zoom: cam.zoom };
}

/**
 * Multiply the zoom by `factor` while keeping the board location under
 * `screenPoint` at the same screen position. The result is clamped to
 * [ZOOM_MIN, ZOOM_MAX]; an invalid factor is ignored.
 */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor) || !isFinitePoint(screenPoint)) return cam;
  const zoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (zoom === cam.zoom) return cam;
  return withZoomAt(cam, zoom, screenPoint);
}

/** Zoom one product step around the centre of the board area. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const anchor = centreOf(viewport);
  // Remove any drift from free-form (wheel / pinch) zooming before stepping.
  const base = withZoomAt(cam, snapZoom(cam.zoom), anchor);
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const target = snapZoom(clamp(base.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  return withZoomAt(base, target, anchor);
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
  return Math.round(cam.zoom * PERCENT);
}
