import type { Camera } from './camera';

declare global {
  interface Window {
    /**
     * Test-only hook, present only in builds with MODE === 'test'. Excluded
     * from production builds by Vite's static env replacement.
     */
    __vidi6?: { setCamera(cam: Camera): void };
  }
}

export function registerTestHooks(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = { setCamera };
}

export function unregisterTestHooks(): void {
  if (import.meta.env.MODE !== 'test') return;
  delete window.__vidi6;
}
