import type { Camera } from './camera';

/**
 * Test-only handles used by the Playwright suite to jump the camera (dragging a
 * million pixels is impractical). Installed only when the client is built with
 * `--mode test`, so production bundles never expose it.
 */
export interface BoardTestHooks {
  setCamera(camera: Partial<Camera>): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export function installBoardTestHooks(hooks: BoardTestHooks): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) delete window.__vidi6;
  };
}
