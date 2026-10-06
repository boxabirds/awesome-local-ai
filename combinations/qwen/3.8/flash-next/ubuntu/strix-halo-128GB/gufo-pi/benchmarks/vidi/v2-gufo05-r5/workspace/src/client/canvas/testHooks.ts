import type { Camera } from './camera';

/**
 * Test-only handle on the running board, enabled only when the bundle is built in
 * `test` mode (`vite build --mode test`, used by Playwright, and Vitest). Production
 * builds (`npm run build`) exclude it entirely.
 */
export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export interface Vidi6TestHooks {
  /** Jump the camera somewhere else, e.g. UNBOUNDED_PAN_TESTED_EXTENT units away. */
  setCamera(cam: Camera): void;
  /** Read the current camera. */
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function registerTestHooks(hooks: Vidi6TestHooks | null): void {
  if (!IS_TEST_MODE) return;
  if (hooks) {
    window.__vidi6 = hooks;
  } else {
    delete window.__vidi6;
  }
}
