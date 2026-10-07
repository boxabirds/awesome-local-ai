import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  WHEEL_ZOOM_SENSITIVITY,
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  SNAP_EPSILON,
  DEFAULT_ORIGIN_MARKER_SIZE,
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

// === screen ↔ world transforms ===

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

// === pan ===

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  // If both deltas are zero, return the same object so React can skip re-render
  if (screenDx === 0 && screenDy === 0) {
    return cam;
  }
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  };
}

// === zoom at a point ===

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Reject invalid factors
  if (!isFinite(factor) || factor <= 0) {
    return cam;
  }

  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));

  // If the clamp didn't actually change zoom, return same object
  if (newZoom === cam.zoom) {
    return cam;
  }

  // Keep the world point under the pointer at the same screen position
  const worldPoint = screenToWorld(cam, screenPoint);
  return {
    x: worldPoint.x - screenPoint.x / newZoom,
    y: worldPoint.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

// === zoom by one step around the centre of the viewport ===

export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const rawFactor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  return zoomAtWithSnap(cam, { x: cx, y: cy }, rawFactor);
}

/**
 * zoomAt but snaps the resulting zoom to the nearest ZOOM_STEP_FACTOR^n
 * when it's within SNAP_EPSILON of such a value. This avoids float drift
 * (e.g., 1.25 × 0.8 should equal exactly 1.0).
 */
function zoomAtWithSnap(
  cam: Camera,
  screenPoint: Point,
  rawFactor: number,
): Camera {
  if (!isFinite(rawFactor) || rawFactor <= 0) {
    return cam;
  }

  const candidateZoom = cam.zoom * rawFactor;
  const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, candidateZoom));

  // If clamping prevents any change, return unchanged
  if (clampedZoom === cam.zoom) {
    return cam;
  }

  // Snap to nearest ZOOM_STEP_FACTOR^n if within epsilon
  let snappedZoom = clampedZoom;
  if (clampedZoom >= ZOOM_MIN && clampedZoom <= ZOOM_MAX) {
    const logZoom = Math.log(clampedZoom);
    const logStep = Math.log(ZOOM_STEP_FACTOR);
    const n = Math.round(logZoom / logStep);
    const steppedValue = Math.pow(ZOOM_STEP_FACTOR, n);
    if (Math.abs(clampedZoom - steppedValue) < SNAP_EPSILON) {
      snappedZoom = steppedValue;
    }
  }

  if (snappedZoom === cam.zoom) {
    return cam;
  }

  // Recalculate using the possibly-snapped zoom
  const worldPoint = screenToWorld(cam, screenPoint);
  return {
    x: worldPoint.x - screenPoint.x / snappedZoom,
    y: worldPoint.y - screenPoint.y / snappedZoom,
    zoom: snappedZoom,
  };
}

// === reset ===

export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

// === canZoom helpers ===

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

// === percentage label ===

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * 100);
}

// === re-export config for convenience ===

export const config = {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  WHEEL_ZOOM_SENSITIVITY,
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  SNAP_EPSILON,
  DEFAULT_ORIGIN_MARKER_SIZE,
};
