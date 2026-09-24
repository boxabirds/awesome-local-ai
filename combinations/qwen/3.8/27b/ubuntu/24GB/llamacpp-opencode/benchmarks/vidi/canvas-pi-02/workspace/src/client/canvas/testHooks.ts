import type { Camera } from './camera';

declare global {
  interface Window {
    /** Test-only camera hook; present only in test builds (`--mode test`). */
    __vidi6?: { setCamera(cam: Camera): void };
  }
}

/**
 * Test hook installation. The `import.meta.env.MODE === 'test'` check is
 * resolved at build time, so the hook is dead-code-eliminated from the plain
 * production build and present in vitest and the e2e build (`--mode test`).
 */
export function installTestHook(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = { setCamera };
}

export function removeTestHook(): void {
  if (import.meta.env.MODE !== 'test') return;
  delete window.__vidi6;
}
