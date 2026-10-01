import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: { setCamera(camera: Camera): void; connectionState?: string };
  }
}

/** Installs `window.__vidi6`; a no-op (and tree-shaken) outside test mode. */
export function installTestHooks(setCamera: (camera: Camera) => void): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = { setCamera };
  return () => { delete window.__vidi6; };
}
