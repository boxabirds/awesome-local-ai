import type { Camera } from './camera';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs the e2e test hook `window.__vidi6` used to jump the camera far
 * away (dragging a million pixels in e2e is impractical). Guarded by the
 * Vite build mode so `vite build` (production) tree-shakes this away and the
 * hook does not exist in production builds.
 */
export function installTestHooks(setCamera: (camera: Camera) => void, getCamera: () => Camera): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { setCamera, getCamera };
  }
}
