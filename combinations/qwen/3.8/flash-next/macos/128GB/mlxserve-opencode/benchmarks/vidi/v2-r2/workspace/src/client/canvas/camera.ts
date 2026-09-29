import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../shared/config';

const PERCENT = 100;
const SNAP_EPSILON = 1e-9;

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
  const newX = cam.x - screenDx / cam.zoom;
  const newY = cam.y - screenDy / cam.zoom;
  if (newX === cam.x && newY === cam.y) return cam;
  return { x: newX, y: newY, zoom: cam.zoom };
}

function clampZoom(z: number): number {
  if (z < ZOOM_MIN) return ZOOM_MIN;
  if (z > ZOOM_MAX) return ZOOM_MAX;
  return z;
}

function snapToStep(zoom: number): number {
  // Find nearest n such that zoom ≈ ZOOM_STEP_FACTOR^n
  const n = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const rounded = Math.round(n);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, rounded);
  if (Math.abs(zoom - snapped) < SNAP_EPSILON) {
    return snapped;
  }
  return zoom;
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Reject invalid factors
  if (!Number.isFinite(factor) || factor <= 0) {
    return cam;
  }

  const newZoom = clampZoom(cam.zoom * factor);

  // If zoom didn't change (at limit), return same object
  if (newZoom === cam.zoom) return cam;

  // Keep world point under pointer invariant
  const w = screenToWorld(cam, screenPoint);
  const newX = w.x - screenPoint.x / newZoom;
  const newY = w.y - screenPoint.y / newZoom;

  return { x: newX, y: newY, zoom: newZoom };
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const result = zoomAt(cam, centre, factor);
  // If result changed zoom, snap to nearest step
  if (result !== cam) {
    const snapped = snapToStep(result.zoom);
    if (snapped !== result.zoom) {
      // Recompute with snapped zoom to maintain pointer invariance
      const w = screenToWorld(cam, centre);
      const newX = w.x - centre.x / snapped;
      const newY = w.y - centre.y / snapped;
      return { x: newX, y: newY, zoom: snapped };
    }
  }
  return result;
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
