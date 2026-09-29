import type { Camera } from './camera';

/**
 * Test-only hooks used by the e2e suite (design: Fixtures). Registered only
 * when `import.meta.env.MODE === 'test'`, so `vite build` (production mode)
 * strips the registration and the hook is absent from the shipped bundle.
 */
export interface Vidi6TestHooks {
  /** Jump the camera anywhere on the board (dragging a million pixels in e2e
   * is impractical). Counts as a camera change. */
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function registerTestHooks(hooks: Vidi6TestHooks): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = hooks;
}
