import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(camera: Camera): void;
      connectionState: ConnectionState;
    };
  }
}

type SetCamera = (camera: Camera) => void;

let setCameraImpl: SetCamera | null = null;

/** Register the active camera setter (one live useCamera instance at a time). */
export function registerSetCamera(impl: SetCamera | null): void {
  setCameraImpl = impl;
}

/** Update the connection state exposed on the test hook. */
export function setConnectionState(state: ConnectionState): void {
  if (window.__vidi6) {
    window.__vidi6.connectionState = state;
  }
}

// Test-only hook, enabled only when the app is built (or served) in test mode.
// Vite substitutes import.meta.env.MODE at build time, so this branch is dead
// code in production builds.
if (import.meta.env.MODE === 'test') {
  window.__vidi6 = {
    setCamera(camera: Camera) {
      setCameraImpl?.(camera);
    },
    connectionState: 'connecting' as ConnectionState,
  };
}

export {};
