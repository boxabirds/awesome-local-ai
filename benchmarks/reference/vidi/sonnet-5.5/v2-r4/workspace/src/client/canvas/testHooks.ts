import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: { setCamera(cam: Camera): void; connectionState?: string };
  }
}

/** Test builds only: exposes the mapped connection state on window.__vidi6. */
export function setTestConnectionState(state: string): void {
  if (import.meta.env.MODE !== 'test' || !window.__vidi6) return;
  window.__vidi6.connectionState = state;
}

/** Installs window.__vidi6; a no-op outside test mode (and dead-code-eliminated from production builds). */
export function installTestHooks(setCamera: (cam: Camera) => void): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = { ...window.__vidi6, setCamera };
  return () => {
    delete window.__vidi6;
  };
}
