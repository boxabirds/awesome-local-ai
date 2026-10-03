import type { Camera } from './canvas/camera';

/**
 * Test-only hooks used by the e2e suite. They are compiled away in production
 * builds because `import.meta.env.MODE` is statically replaced with the mode
 * string ("production" for `npm run build`, "test" for `npm run build:test`).
 */
export interface Vidi6TestHooks {
  setCamera(camera: Partial<Camera>): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function registerCameraHook(setCamera: (camera: Partial<Camera>) => void): () => void {
  if (!IS_TEST_MODE) {
    return () => {};
  }
  const hooks: Vidi6TestHooks = { ...window.__vidi6, setCamera };
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) {
      delete window.__vidi6;
    }
  };
}
