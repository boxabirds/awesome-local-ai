import type { Camera } from './camera';

export interface Vidi6TestHooks {
  /** Jump the camera anywhere (e.g. 1,000,000 units away); test builds only. */
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs `window.__vidi6` in test mode only. `import.meta.env.MODE` is
 * replaced at build time, so production builds drop this code entirely.
 * Returns an uninstall function.
 */
export function installTestHooks(hooks: Vidi6TestHooks): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) delete window.__vidi6;
  };
}
