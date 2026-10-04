import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(next: Camera): void;
    };
  }
}

/**
 * Install the test-only hook `window.__vidi6.setCamera`.
 *
 * Enabled only when the Vite build mode is `test` (`vite build --mode test`),
 * so it is tree-shaken out of production builds. Used by e2e to jump far away
 * (dragging a million pixels is impractical).
 */
export function installTestHook(setCamera: (next: Camera) => void): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { setCamera };
  }
}

export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}
