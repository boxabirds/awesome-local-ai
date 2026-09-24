import type { Camera } from './camera';

/**
 * Test-only hooks exposed as `window.__vidi6`. Installed only when
 * `import.meta.env.MODE === 'test'` (Vitest, and the `build:test` bundle that e2e
 * runs against). The guarded call site lets production builds drop this module.
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

export function installTestHooks(hooks: Vidi6TestHooks): () => void {
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) delete window.__vidi6;
  };
}
