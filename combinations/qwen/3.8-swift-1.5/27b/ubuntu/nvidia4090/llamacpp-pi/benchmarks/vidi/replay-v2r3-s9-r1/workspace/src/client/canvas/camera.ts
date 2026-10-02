import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../shared/config';

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

const PERCENT = 100;
const STEP_SNAP_EPSILON = 1e-9;

export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  };
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam;
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Reject invalid factors
  if (!Number.isFinite(factor) || factor <= 0) return cam;

  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;

  // Keep the world point under the screen point fixed
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const center: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;

  // Compute target zoom and snap to nearest ZOOM_STEP_FACTOR^n
  const targetZoom = cam.zoom * factor;
  const snappedZoom = snapToStepZoom(targetZoom);

  // Clamp to limits
  const clampedZoom = clamp(snappedZoom, ZOOM_MIN, ZOOM_MAX);

  if (clampedZoom === cam.zoom) return cam;

  const actualFactor = clampedZoom / cam.zoom;
  return zoomAt(cam, center, actualFactor);
}

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
  return Math.round(cam.zoom * PERCENT);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function snapToStepZoom(zoom: number): number {
  // Find n such that ZOOM_STEP_FACTOR^n is closest to zoom
  const n = Math.round(Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);
  // Only snap if within epsilon
  if (Math.abs(snapped - zoom) <= STEP_SNAP_EPSILON * Math.max(1, zoom)) {
    return snapped;
  }
  return zoom;
}
