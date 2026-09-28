import type { Camera } from './camera';

/**
 * Test-only hooks, enabled only when the client is built with
 * `import.meta.env.MODE === 'test'` (`npm run build:test`). In a production
 * build the condition folds to false and this code is dropped.
 *
 * `window.__vidi6.setCamera(x, y, zoom)` lets tests jump to a location far
 * from the start (dragging a million pixels in e2e is impractical).
 */

export interface Vidi6TestApi {
  setCamera(x: number, y: number, zoom: number): void;
  getCamera(): Camera | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export interface CameraTestBridge {
  get(): Camera;
  set(cam: Camera): void;
}

/** Install `window.__vidi6`; returns a cleanup function. */
export function installCameraTestHook(bridge: CameraTestBridge): () => void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return () => {};
  const api: Vidi6TestApi = {
    setCamera(x: number, y: number, zoom: number) {
      bridge.set({ x, y, zoom });
    },
    getCamera() {
      return bridge.get();
    },
  };
  window.__vidi6 = api;
  return () => {
    if (window.__vidi6 === api) delete window.__vidi6;
  };
}
