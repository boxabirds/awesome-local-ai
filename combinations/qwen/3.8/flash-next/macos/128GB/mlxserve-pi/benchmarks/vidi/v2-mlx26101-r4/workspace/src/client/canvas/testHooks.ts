import type { Camera } from './camera';

/**
 * Test-only hooks, installed only when the app is built with
 * `import.meta.env.MODE === 'test'` (`npm run build:test`). Dragging a million
 * pixels in an e2e test is impractical, so the tests jump the camera directly.
 * The call site in `cameraStore.ts` is folded away in production builds, so
 * `window.__vidi6` never exists there.
 */
export interface Vidi6TestHooks {
  /** Merge a partial camera (x, y, zoom) into the current camera. */
  setCamera(patch: Partial<Camera>): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(hooks: Vidi6TestHooks): void {
  window.__vidi6 = hooks;
}
