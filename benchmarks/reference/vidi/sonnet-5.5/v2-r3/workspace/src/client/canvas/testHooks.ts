import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: { setCamera(cam: Camera): void };
  }
}

/** Installs window.__vidi6 in test mode only; the branch is removed from production builds. */
export function installTestHooks(setCamera: (cam: Camera) => void): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = { setCamera };
  return () => {
    delete window.__vidi6;
  };
}
