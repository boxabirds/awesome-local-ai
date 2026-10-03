import type { Camera } from './camera';

/**
 * Hooks used only by the end-to-end tests (e.g. jumping a million board units
 * away is impractical by dragging). `import.meta.env.MODE` is replaced at build
 * time, so in a production build these branches are dead code and removed.
 */
export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function registerTestHooks(hooks: Vidi6TestHooks): void {
  if (!IS_TEST_MODE) return;
  window.__vidi6 = hooks;
}
