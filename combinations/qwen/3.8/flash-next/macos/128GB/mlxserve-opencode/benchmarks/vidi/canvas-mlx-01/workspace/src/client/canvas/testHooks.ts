import type { Camera } from './camera.js';

/**
 * Test-only hooks used by the Playwright suite to jump the camera (dragging a
 * million pixels is impractical). Registered only when the client is built in
 * "test" mode, so they do not exist in production builds.
 */
export interface Vidi6TestHooks {
  setCamera(next: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function testHooksEnabled(): boolean {
  return import.meta.env.MODE === 'test';
}

export function registerTestHooks(
  setCamera: (next: Camera) => void,
  getCamera: () => Camera,
): void {
  if (!testHooksEnabled() || typeof window === 'undefined') return;
  window.__vidi6 = { setCamera, getCamera };
}
