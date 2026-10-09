import type { Camera } from './camera';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

// Test-only hook used by e2e to jump far away and to read camera state.
// Guarded by import.meta.env.MODE so it is dead-code eliminated from
// production builds (call sites check the mode before importing/calling).
export function installTestHook(hooks: Vidi6TestHooks): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = hooks;
  }
}
