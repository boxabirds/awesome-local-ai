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
const SNAP_EPSILON = 1e-9;

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

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

function clampZoom(zoom: number): number {
  if (zoom < ZOOM_MIN) return ZOOM_MIN;
  if (zoom > ZOOM_MAX) return ZOOM_MAX;
  return zoom;
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!isValidFactor(factor)) return cam;

  const newZoom = clampZoom(cam.zoom * factor);
  if (newZoom === cam.zoom) return cam;

  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

function snapToStep(zoom: number): number {
  // Snap zoom to nearest ZOOM_STEP_FACTOR^n if within SNAP_EPSILON
  // n = log(ZOOM_STEP_FACTOR, zoom)
  const n = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const nearestN = Math.round(n);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, nearestN);
  if (Math.abs(snapped - zoom) / zoom < SNAP_EPSILON) {
    return snapped;
  }
  return zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const next = zoomAt(cam, centre, factor);

  if (next === cam) return cam;

  // Snap zoom to avoid float drift
  const snappedZoom = snapToStep(next.zoom);
  if (snappedZoom === next.zoom) return next;

  // Re-compute position with snapped zoom
  const w = screenToWorld(cam, centre);
  return {
    x: w.x - centre.x / snappedZoom,
    y: w.y - centre.y / snappedZoom,
    zoom: snappedZoom,
  };
}

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
