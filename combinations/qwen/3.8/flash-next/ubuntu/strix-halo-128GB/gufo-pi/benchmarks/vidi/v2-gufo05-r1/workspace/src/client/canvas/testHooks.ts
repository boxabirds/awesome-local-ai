/**
 * Test-only bridge used by the e2e suite to jump the camera to a location far
 * from the start (dragging a million pixels is impractical).
 *
 * `IS_TEST_MODE` is a build-time constant, so the whole branch is removed from
 * production bundles.
 */
import type { Camera } from './camera';

export interface Vidi6TestApi {
  /** Move the camera immediately; values are validated, invalid input ignored. */
  setCamera(camera: Partial<Camera>): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function installTestHooks(api: Vidi6TestApi): void {
  window.__vidi6 = api;
}

export function isValidCamera(value: unknown): value is Camera {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, zoom } = value as Partial<Camera>;
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof zoom === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(zoom) &&
    zoom > 0
  );
}
