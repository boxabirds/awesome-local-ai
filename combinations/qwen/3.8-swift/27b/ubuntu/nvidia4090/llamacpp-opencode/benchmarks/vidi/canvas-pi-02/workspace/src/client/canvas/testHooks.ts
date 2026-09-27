// Test-only hooks, installed only in builds made with `--mode test`.
// Production builds never expose window.__vidi6.

import type { CameraApi } from './useCamera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(x: number, y: number, zoom: number): void;
    };
  }
}

export function installTestHooks(getApi: () => CameraApi): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = {
    setCamera(x: number, y: number, zoom: number) {
      getApi().setCamera({ x, y, zoom });
    },
  };
}
