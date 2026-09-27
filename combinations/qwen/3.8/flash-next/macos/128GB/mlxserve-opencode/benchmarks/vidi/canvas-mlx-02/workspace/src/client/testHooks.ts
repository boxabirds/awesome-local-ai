// Test-only hook. Imported dynamically ONLY when import.meta.env.MODE === 'test',
// so it is excluded from production builds (dead-code eliminated).
import type { Camera } from './canvas/camera.ts';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(camera: Camera): void;
    };
  }
}

export function installTestHooks(setCamera: (camera: Camera) => void): void {
  window.__vidi6 = { setCamera };
}
