import type { Camera } from './camera';
import type { CameraPatch } from './useCamera';

/** Test-only API mounted on `window.__vidi6` in the test build. */
export interface Vidi6TestApi {
  /** Jumps the camera somewhere else (e.g. one million units from the start). */
  setCamera(patch: CameraPatch): void;
  /** Reads the current camera. */
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

/**
 * Installs the test hook. Only ever called from code guarded by
 * `import.meta.env.MODE === 'test'`, so it is tree-shaken out of production
 * builds.
 */
export function registerTestHooks(api: Vidi6TestApi): () => void {
  window.__vidi6 = api;
  return () => {
    if (window.__vidi6 === api) delete window.__vidi6;
  };
}
