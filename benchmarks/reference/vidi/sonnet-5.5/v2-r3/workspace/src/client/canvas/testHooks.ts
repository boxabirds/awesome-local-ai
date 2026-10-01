import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: { setCamera?(cam: Camera): void; connectionState?: ConnectionState };
  }
}

const isTest = () => import.meta.env.MODE === 'test';

/** Installs window.__vidi6.setCamera in test mode only; the branch is removed from production builds. */
export function installTestHooks(setCamera: (cam: Camera) => void): () => void {
  if (!isTest()) return () => {};
  window.__vidi6 = { ...window.__vidi6, setCamera };
  return () => {
    if (window.__vidi6) delete window.__vidi6.setCamera;
  };
}

/** Exposes the mapped connection state on window.__vidi6.connectionState (test builds only). */
export function publishConnectionState(state: ConnectionState): void {
  if (!isTest()) return;
  window.__vidi6 = { ...window.__vidi6, connectionState: state };
}
