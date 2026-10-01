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
  const existing = window.__vidi6 ?? {};
  window.__vidi6 = { ...existing, setCamera };
}
