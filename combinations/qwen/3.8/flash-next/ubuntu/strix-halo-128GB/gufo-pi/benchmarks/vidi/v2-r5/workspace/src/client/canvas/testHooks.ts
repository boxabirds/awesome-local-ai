import type { Camera } from './camera';

/**
 * Test-only hooks. Enabled only when the app is built/run in `test` mode
 * (`vite build --mode test`, Vitest), so they are dead-code-eliminated from
 * production builds. Used by the component and e2e suites to jump the camera
 * long distances (dragging a million pixels is impractical) and to read the
 * live camera state.
 */
export interface BoardTestHooks {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export const TEST_HOOKS_ENABLED: boolean = import.meta.env.MODE === 'test';

export function installTestHooks(api: BoardTestHooks): void {
  if (!TEST_HOOKS_ENABLED) return;
  window.__vidi6 = api;
}

export function uninstallTestHooks(): void {
  if (!TEST_HOOKS_ENABLED) return;
  delete window.__vidi6;
}
