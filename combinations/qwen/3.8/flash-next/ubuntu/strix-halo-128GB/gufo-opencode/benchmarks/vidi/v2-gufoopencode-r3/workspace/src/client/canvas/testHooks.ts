import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
    };
  }
}

// Test-only hook so e2e tests can jump the camera far away without dragging
// a million pixels. Tree-shaken out of production builds (MODE !== 'test').
export function installTestHooks(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = { setCamera };
}
