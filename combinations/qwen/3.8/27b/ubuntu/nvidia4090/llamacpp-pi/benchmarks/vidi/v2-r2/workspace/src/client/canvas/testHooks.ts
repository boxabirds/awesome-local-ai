import type { Camera } from './camera';

declare global {
  interface Window {
    /** Test-only board control (e2e); absent in production builds. */
    __vidi6?: {
      setCamera(cam: Camera): void;
    };
  }
}

/**
 * Installs the `window.__vidi6.setCamera()` test hook, but only in test
 * builds (`vite build --mode test` / Vitest). In production builds the
 * condition is statically false, so the hook is excluded from the bundle.
 */
export function installVidi6TestHooks(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  window.__vidi6 = { setCamera };
}
