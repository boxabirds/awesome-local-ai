import type { Camera } from './camera';

interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
      setCamera,
    };
  }
}
