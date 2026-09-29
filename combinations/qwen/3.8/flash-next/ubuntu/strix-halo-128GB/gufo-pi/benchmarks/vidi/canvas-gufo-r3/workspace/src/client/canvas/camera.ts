import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '@shared/config';

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
  // Reject invalid factors
  if (!Number.isFinite(factor) || factor <= 0) return cam;

  const newZoomRaw = cam.zoom * factor;
  const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoomRaw));

  if (newZoom === cam.zoom) return cam;

  // Keep the world point under the screen point invariant
  const wx = screenPoint.x / cam.zoom + cam.x;
  const wy = screenPoint.y / cam.zoom + cam.y;

  return {
    x: wx - screenPoint.x / newZoom,
    y: wy - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

function snapToStepFactor(zoom: number): number {
  // Find the nearest n such that ZOOM_STEP_FACTOR^n is close to zoom
  const n = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR);
  const roundedN = Math.round(n);
  const snapped = Math.pow(ZOOM_STEP_FACTOR, roundedN);
  if (Math.abs(snapped - zoom) < SNAP_EPSILON) {
    return snapped;
  }
  return zoom;
}

export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const result = zoomAt(cam, centre, factor);
  if (result === cam) return cam;
  // Snap to eliminate float drift
  const snapped = snapToStepFactor(result.zoom);
  if (snapped === result.zoom) return result;
  // Recompute camera position with snapped zoom keeping centre invariant
  const wx = centre.x / cam.zoom + cam.x;
  const wy = centre.y / cam.zoom + cam.y;
  return {
    x: wx - centre.x / snapped,
    y: wy - centre.y / snapped,
    zoom: snapped,
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
  return cam.zoom < ZOOM_MAX - SNAP_EPSILON;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN + SNAP_EPSILON;
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT);
}
