import type { Camera } from './camera';

declare global {
  interface Window {
    /** Test-only hook, present only in the `test` build mode. */
    __vidi6?: { setCamera(cam: Camera): void };
  }
}

/**
 * Install the test-only `window.__vidi6.setCamera` hook. It is only registered
 * when running in the `test` build mode, so it is absent from production builds
 * (the dead branch is removed at build time).
 */
export function installTestHook(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { setCamera };
  }
}
