import type { Camera } from './camera';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs `window.__vidi6` in test builds only (`vite build --mode test`, Vitest).
 * `import.meta.env.MODE` is replaced at build time, so production bundles drop this code.
 * Returns an uninstall function.
 */
export function installTestHooks(hooks: Vidi6TestHooks): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) delete window.__vidi6;
  };
}
