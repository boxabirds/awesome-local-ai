import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
    };
  }
}

export function registerTestHooks(setCamera: (cam: Camera) => void) {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { setCamera };
  }
}
