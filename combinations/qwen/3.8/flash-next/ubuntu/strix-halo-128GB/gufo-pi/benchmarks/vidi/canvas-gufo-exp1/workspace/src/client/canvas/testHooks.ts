/**
 * Test-only hooks, installed only when the client is built with `--mode test`
 * (`import.meta.env.MODE === 'test'`). Production builds never expose them.
 *
 * `setCamera` lets a test jump far away instead of dragging a million pixels;
 * `getCamera` lets a test read the exact camera after an interaction.
 */
import type { Camera } from './camera';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  reset(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/** Register the hooks for the lifetime of a mounted board; returns a cleanup function. */
export function installTestHooks(hooks: Vidi6TestHooks): () => void {
  // The mode check is inlined so a production build dead-code-eliminates the branch.
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = hooks;
    return () => {
      delete window.__vidi6;
    };
  }
  return () => {};
}
