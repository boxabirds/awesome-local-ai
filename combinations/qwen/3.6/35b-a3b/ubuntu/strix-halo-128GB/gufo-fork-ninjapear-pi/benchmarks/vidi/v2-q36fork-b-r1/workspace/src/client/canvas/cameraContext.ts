/**
 * Simple mutable store for sharing camera state between components.
 * Updated by BoardViewport, read by Toolbar/create handlers.
 */
import type { Camera } from './camera';

let _camera: Camera = { x: 0, y: 0, zoom: 1 };

export function getCurrentCamera(): Camera {
  return _camera;
}

export function setCurrentCamera(cam: Camera): void {
  _camera = cam;
}
