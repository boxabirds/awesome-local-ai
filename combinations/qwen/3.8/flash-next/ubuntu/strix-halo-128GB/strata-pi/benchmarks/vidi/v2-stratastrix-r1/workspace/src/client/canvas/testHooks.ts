import type { Camera } from './camera';

/**
 * Test-only navigation API.
 *
 * `window.__vidi6` lets the e2e suite jump the camera to a position a real user
 * could never drag to (a million pixels away) and read the camera back. It is
 * installed only when the bundle is built in `test` mode: `import.meta.env.MODE`
 * is a build-time constant, so the whole block is dead code that the production
 * build tree-shakes away.
 */
export interface Vidi6TestHooks {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  resetView(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function installTestHooks(api: Vidi6TestHooks): () => void {
  if (!IS_TEST_MODE) return () => {};

  window.__vidi6 = api;
  return () => {
    if (window.__vidi6 === api) delete window.__vidi6;
  };
}
