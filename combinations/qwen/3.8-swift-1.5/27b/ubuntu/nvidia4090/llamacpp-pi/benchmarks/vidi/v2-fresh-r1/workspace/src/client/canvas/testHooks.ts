import type { Camera } from './camera';

/**
 * Test-only hook: `window.__vidi6.setCamera` lets e2e tests jump the camera
 * to a far location (dragging a million pixels is impractical). Enabled
 * only when `import.meta.env.MODE === 'test'`, so the block is
 * dead-code-eliminated from production builds.
 */
export function installTestHooks(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test') return;
  (window as { __vidi6?: { setCamera: (cam: Camera) => void } }).__vidi6 = { setCamera };
}
