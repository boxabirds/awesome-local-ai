import type { Camera } from './camera';

/** Test-only handle on the live camera, installed when MODE === 'test'. */
export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/**
 * Install `window.__vidi6` so Playwright e2e tests can jump the camera far away
 * (dragging a million pixels is impractical). In production builds
 * `import.meta.env.MODE` is `"production"`, so this is a no-op and the branch is
 * tree-shaken out of the bundle.
 */
export function installTestHooks(
  get: () => Camera,
  set: (cam: Camera) => void,
): () => void {
  if (!IS_TEST_MODE) return () => {};
  window.__vidi6 = {
    setCamera: (cam) => set({ x: cam.x, y: cam.y, zoom: cam.zoom }),
    getCamera: get,
  };
  return () => {
    delete window.__vidi6;
  };
}
