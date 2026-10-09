import type { Camera } from './camera';

/** The parts of `window` the test-mode hook adds. */
declare global {
  interface Window {
    __vidi6?: {
      setCamera(camera: Camera): void;
    };
  }
}

export interface TestHooks {
  setCamera(camera: Camera): void;
}

/**
 * `window.__vidi6` exists only in the test build so e2e tests can jump to a
 * far-away camera instead of dragging a million pixels. Callers guard the call
 * with `import.meta.env.MODE === 'test'` as well, so production bundles drop
 * this module entirely.
 */
export function registerTestHooks(hooks: TestHooks): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = { ...window.__vidi6, ...hooks };
}
