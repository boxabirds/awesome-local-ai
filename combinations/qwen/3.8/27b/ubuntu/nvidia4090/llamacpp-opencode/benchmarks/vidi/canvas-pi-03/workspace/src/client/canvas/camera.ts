import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '@/shared/config';

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

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return cam;
  const newZoom = Math.min(Math.max(cam.zoom * factor, ZOOM_MIN), ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

function snapToStep(zoom: number): number {
  // Snap to nearest ZOOM_STEP_FACTOR^n if within epsilon
  if (zoom === 0) return zoom;
  const n = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const rounded = Math.round(n);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, rounded);
  if (Math.abs(zoom - snapped) < SNAP_EPSILON) return snapped;
  return zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;

  const newZoom = Math.min(Math.max(cam.zoom * factor, ZOOM_MIN), ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;

  const snappedZoom = snapToStep(newZoom);
  const w = screenToWorld(cam, center);
  return {
    x: w.x - center.x / snappedZoom,
    y: w.y - center.y / snappedZoom,
    zoom: snappedZoom,
  };
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
