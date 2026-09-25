/**
 * Test-only hooks (design Fixtures): `window.__vidi6.setCamera()` lets e2e tests jump
 * far across the board without dragging a million pixels. Installed only when
 * `import.meta.env.MODE === 'test'`; the production build strips the call.
 */
import type { Camera } from './camera';

export interface Vidi6TestHooks {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(hooks: Vidi6TestHooks): () => void {
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) delete window.__vidi6;
  };
}
