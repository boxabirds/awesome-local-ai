// Test-only hook: window.__vidi6.setCamera() to jump the camera (e2e fixtures,
// see spec Fixtures). Enabled only in test mode; the guard is statically
// replaced in production builds so the hook is excluded from them.

import type { Camera } from './camera';

export interface Vidi6TestApi {
  setCamera(cam: Camera): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export function installTestHooks(api: Vidi6TestApi): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = api;
  }
}
