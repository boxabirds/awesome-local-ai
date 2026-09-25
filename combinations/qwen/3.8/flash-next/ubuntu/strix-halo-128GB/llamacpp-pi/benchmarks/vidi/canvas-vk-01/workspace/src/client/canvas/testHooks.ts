import type { Camera } from './camera';
import type { CameraStore } from './useCamera';

/**
 * Test-only hook used by the e2e suite to jump the camera to an exact location
 * (dragging a million pixels is not practical). `TEST_HOOKS_ENABLED` is a
 * constant after the Vite build, so in production builds this module compiles
 * to nothing and `window.__vidi6` never exists.
 */

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const TEST_HOOKS_ENABLED = import.meta.env.MODE === 'test';

let activeStore: CameraStore | null = null;

export function registerCameraStore(store: CameraStore): void {
  if (!TEST_HOOKS_ENABLED) return;
  activeStore = store;
  window.__vidi6 = {
    setCamera: (camera: Camera) => activeStore?.setCamera(camera),
    getCamera: () => store.getSnapshot().camera,
  };
}

export function unregisterCameraStore(store: CameraStore): void {
  if (!TEST_HOOKS_ENABLED) return;
  if (activeStore === store) {
    activeStore = null;
    delete window.__vidi6;
  }
}
