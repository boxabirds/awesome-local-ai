import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, ZOOM_SNAP_EPSILON } from '@shared/config';

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

/** Convert a screen-space point to world coordinates. */
export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  };
}

/** Convert a world coordinate to screen-space point. */
export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  };
}

/** Pan by a screen-space delta. Returns a new Camera (or same if no-op). */
export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  const dx = screenDx / cam.zoom;
  const dy = screenDy / cam.zoom;
  if (dx === 0 && dy === 0) return cam;
  return { x: cam.x - dx, y: cam.y - dy, zoom: cam.zoom };
}

/** Zoom around a screen-space point by a factor. Returns same object if unchanged. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Reject invalid factors: non-finite or ≤ 0
  if (!Number.isFinite(factor) || factor <= 0) return cam;

  const newZoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === cam.zoom) return cam;

  // Keep the world point under the pointer invariant
  const w = screenToWorld(cam, screenPoint);
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  };
}

/** Zoom one step in or out around viewport centre with snapping. */
export function zoomStep(cam: Camera, viewport: Size, direction: 'in' | 'out'): Camera {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
  const newZoomRaw = cam.zoom * factor;

  // Snap to nearest ZOOM_STEP_FACTOR^n within epsilon to avoid float drift
  const n = Math.round(Math.log(newZoomRaw / ZOOM_STEP_FACTOR) / Math.log(ZOOM_STEP_FACTOR));
  const snapped = Math.pow(ZOOM_STEP_FACTOR, n);

  // If snapped is within epsilon of raw, use snapped; otherwise use raw (but still clamp)
  const newZoom = snapped !== 0 && Math.abs(newZoomRaw - snapped) < ZOOM_SNAP_EPSILON
    ? clamp(snapped, ZOOM_MIN, ZOOM_MAX)
    : clamp(newZoomRaw, ZOOM_MIN, ZOOM_MAX);

  if (newZoom === cam.zoom) return cam;

  const w = screenToWorld(cam, { x: cx, y: cy });
  return {
    x: w.x - cx / newZoom,
    y: w.y - cy / newZoom,
    zoom: newZoom,
  };
}

/** Reset camera to show origin centred in viewport at 100%. */
export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 };
}

/** Whether another zoom-in would increase the zoom value. */
export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX;
}

/** Whether another zoom-out would decrease the zoom value. */
export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Current zoom as a whole-number percentage. */
export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * 100);
}

// ── internal helpers ────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
