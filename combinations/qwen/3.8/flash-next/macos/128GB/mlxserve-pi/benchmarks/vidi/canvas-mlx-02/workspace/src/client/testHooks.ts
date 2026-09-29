// Test-only hook. Imported dynamically ONLY when import.meta.env.MODE === 'test',
// so it is excluded from production builds (dead-code eliminated).
import type { Camera } from './canvas/camera.ts';
import type { ConnectionState } from './collab/connectBoard.ts';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(camera: Camera): void;
      getCamera(): Camera;
      // Live connection state mirror, for the e2e reconnect assertions.
      connectionState?: ConnectionState;
      // Force the real provider socket down/up (drives the reconnect + resync).
      disconnect?(): void;
      connect?(): void;
    };
  }
}

export interface TestHooksApi {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

// Merge, so the camera hook (installed by the viewport) and the connection-state
// mirror (written by App) coexist on window.__vidi6.
export function installTestHooks(api: TestHooksApi): void {
  window.__vidi6 = { ...window.__vidi6, ...api };
}
