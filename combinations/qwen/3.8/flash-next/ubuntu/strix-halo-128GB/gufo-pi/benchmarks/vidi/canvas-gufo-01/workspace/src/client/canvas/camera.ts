// Camera math: screen space (CSS pixels) <-> world space. Pure functions so the
// Durable Object, tests and components share one definition.

import { ZOOM_MAX, ZOOM_MIN } from '../../shared/config';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function screenToWorld(cam: Camera, sx: number, sy: number): Point {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): Point {
  return { x: wx * cam.zoom + cam.x, y: wy * cam.zoom + cam.y };
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const zoom = clampZoom(cam.zoom * factor);
  const anchor = screenToWorld(cam, sx, sy);
  return { zoom, x: sx - anchor.x * zoom, y: sy - anchor.y * zoom };
}

export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom };
}

/** Fit every world point in `points` into a `width`x`height` viewport. */
export function fitBounds(
  points: readonly Point[],
  width: number,
  height: number,
  padding = 48,
): Camera {
  if (points.length === 0) return { ...IDENTITY_CAMERA };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const zoom = clampZoom(Math.min((width - padding * 2) / w, (height - padding * 2) / h));
  return {
    zoom,
    x: width / 2 - ((minX + maxX) / 2) * zoom,
    y: height / 2 - ((minY + maxY) / 2) * zoom,
  };
}
