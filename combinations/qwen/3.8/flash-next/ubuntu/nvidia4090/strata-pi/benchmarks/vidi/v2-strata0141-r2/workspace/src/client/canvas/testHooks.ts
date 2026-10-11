import type { Camera } from './camera';
import { zoomPercent } from './camera';
import type { CameraController } from './useCamera';

/**
 * Test-only API, installed only when `import.meta.env.MODE === 'test'`.
 * Used by the e2e suite to jump far away instead of dragging a million pixels.
 * The guard is a compile-time constant in production builds, so this module is
 * tree-shaken out of the shipped bundle.
 */
export interface Vidi6TestApi {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  getZoomPercent(): number;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export function installTestHooks(controllerRef: { current: CameraController }): void {
  if (typeof window === 'undefined') {
    return;
  }
  // Merged, not replaced: `connectBoard` puts the connection state on the same
  // hook, and the board's camera is installed again whenever it changes.
  window.__vidi6 = {
    ...window.__vidi6,
    setCamera(camera: Camera): void {
      controllerRef.current.setCamera(camera);
    },
    getCamera(): Camera {
      return controllerRef.current.camera;
    },
    getZoomPercent(): number {
      return zoomPercent(controllerRef.current.camera);
    },
  };
}
