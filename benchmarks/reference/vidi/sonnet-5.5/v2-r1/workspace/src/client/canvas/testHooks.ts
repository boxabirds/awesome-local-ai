import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: { setCamera(cam: Camera): void; getCamera(): Camera; readonly connectionState: string };
  }
}

let connectionState = 'connecting';

/** Records the mapped connection state for the test-only hook (read through `window.__vidi6.connectionState`). */
export function reportConnectionState(state: string): void {
  connectionState = state;
}

/** Test-only window hook; compiled out of production builds (see vite `MODE`). */
export function installTestHooks(setCamera: (cam: Camera) => void, getCamera: () => Camera): (() => void) | void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = {
    setCamera,
    getCamera,
    get connectionState() {
      return connectionState;
    },
  };
  return () => {
    delete window.__vidi6;
  };
}
