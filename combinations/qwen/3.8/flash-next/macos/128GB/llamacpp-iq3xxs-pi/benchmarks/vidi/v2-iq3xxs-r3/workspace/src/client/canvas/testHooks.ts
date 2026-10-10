import type { Camera } from './camera';

/**
 * Test-only hooks. Call sites guard with `import.meta.env.MODE === 'test'` so
 * Vite replaces the mode with a literal in production builds and drops the code
 * entirely (see `npm run build` vs `npm run build:test`).
 */
export interface BoardTestApi {
  /** Jump the camera anywhere, e.g. 1,000,000 board units away (TC-26, TC-27). */
  setCamera(camera: Camera): void;
  /** The camera the board is currently rendering. */
  getCamera(): Camera;
  /** Return to the standard view (100%, board start centred). */
  reset(): void;
}

declare global {
  interface Window {
    __vidi6?: BoardTestApi;
  }
}

export function installTestHooks(api: BoardTestApi): () => void {
  window.__vidi6 = api;
  return () => {
    delete window.__vidi6;
  };
}
