import type { Camera } from './camera.js';

/**
 * Test-only hook for jumping the camera around the board. Dragging a million
 * pixels in an e2e test is impractical, so e2e teleports instead
 * (design "Fixtures"). Registered only when `import.meta.env.MODE === 'test'`
 * (i.e. `vite build --mode test`); the condition is a build-time constant so
 * dead-code elimination removes this from production builds.
 */
export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function registerTestHooks(api: Vidi6TestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  window.__vidi6 = api;
}

export function clearTestHooks(): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  delete window.__vidi6;
}

export function testHooks(): Vidi6TestHooks | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__vidi6;
}
