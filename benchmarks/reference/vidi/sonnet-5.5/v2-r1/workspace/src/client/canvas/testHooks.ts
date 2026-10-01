import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: { setCamera(cam: Camera): void; getCamera(): Camera };
  }
}

/** Test-only window hook; compiled out of production builds (see vite `MODE`). */
export function installTestHooks(setCamera: (cam: Camera) => void, getCamera: () => Camera): (() => void) | void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = { setCamera, getCamera };
  return () => {
    delete window.__vidi6;
  };
}
