import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../shared/config'

export interface Camera {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

// --- Snap epsilon for zoomStep to avoid float drift ---
const SNAP_EPSILON = 1e-9
const PERCENT = 100

function snapToStep(zoom: number): number {
  const logZoom = Math.log(zoom) / Math.log(ZOOM_STEP_FACTOR)
  const nearest = Math.round(logZoom)
  const snapped = Math.pow(ZOOM_STEP_FACTOR, nearest)
  return Math.abs(zoom - snapped) < SNAP_EPSILON ? snapped : zoom
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  }
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  }
}

export function panBy(cam: Camera, screenDx: number, screenDy: number): Camera {
  if (screenDx === 0 && screenDy === 0) return cam
  return {
    x: cam.x - screenDx / cam.zoom,
    y: cam.y - screenDy / cam.zoom,
    zoom: cam.zoom,
  }
}

export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  // Reject invalid factors: non-finite, zero, negative, NaN
  if (!Number.isFinite(factor) || factor <= 0) return cam

  const newZoom = Math.min(Math.max(cam.zoom * factor, ZOOM_MIN), ZOOM_MAX)
  if (newZoom === cam.zoom) return cam

  // Keep world point under screenPoint invariant
  const w = screenToWorld(cam, screenPoint)
  return {
    x: w.x - screenPoint.x / newZoom,
    y: w.y - screenPoint.y / newZoom,
    zoom: newZoom,
  }
}

export function zoomStep(
  cam: Camera,
  viewport: Size,
  direction: 'in' | 'out',
): Camera {
  const factor = direction === 'in' ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR
  const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 }
  const result = zoomAt(cam, centre, factor)
  if (result === cam) return cam
  // Snap to avoid float drift (1.25 * 0.8 should be exactly 1.0)
  const snappedZoom = snapToStep(result.zoom)
  if (snappedZoom === result.zoom) return result
  // Re-apply zoomAt with the snapped zoom to keep pointer invariant
  const w = screenToWorld(cam, centre)
  return {
    x: w.x - centre.x / snappedZoom,
    y: w.y - centre.y / snappedZoom,
    zoom: snappedZoom,
  }
}

export function resetCamera(viewport: Size): Camera {
  return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 }
}

export function canZoomIn(cam: Camera): boolean {
  return cam.zoom < ZOOM_MAX
}

export function canZoomOut(cam: Camera): boolean {
  return cam.zoom > ZOOM_MIN
}

export function zoomPercent(cam: Camera): number {
  return Math.round(cam.zoom * PERCENT)
}
