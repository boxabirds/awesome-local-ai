import type { Camera } from './camera';
import type { CameraApi } from './useCamera';

/**
 * Test-only handle on the live camera, used by the e2e suite to jump far away
 * (dragging a million pixels is impractical) and to read back the camera.
 * Installed only when `import.meta.env.MODE === 'test'`, so production builds
 * contain no hook.
 */
export interface BoardTestHooks {
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export function installBoardTestHooks(getApi: () => CameraApi | null): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.MODE !== 'test') return;
  const hooks: BoardTestHooks = {
    setCamera(camera) {
      getApi()?.setCamera({
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
      });
    },
    getCamera() {
      return getApi()?.camera ?? { x: 0, y: 0, zoom: 1 };
    },
  };
  window.__vidi6 = hooks;
}

export function removeBoardTestHooks(): void {
  if (typeof window === 'undefined') return;
  delete window.__vidi6;
}
