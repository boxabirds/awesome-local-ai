import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getCamera(): Camera;
    };
  }
}

export function registerTestHooks(
  setCamera: (cam: Camera) => void,
  getCamera: () => Camera,
): void {
  // Always register for dev/test/E2E usage
  window.__vidi6 = { setCamera, getCamera };
}
