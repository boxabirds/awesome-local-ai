import type { Camera } from './canvas/camera';
import type { ConnectionState } from './sync/connectBoard';

/** A partial camera, as passed by the e2e test hook. */
export interface TestCamera {
  x?: number;
  y?: number;
  zoom?: number;
}

/** Test-only API installed on `window` in the `test` build only. */
export interface Vidi6TestApi {
  getCamera(): Camera;
  setCamera(camera: TestCamera): void;
  readonly connectionState: ConnectionState;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

/**
 * True only in the `test` build (`vite build --mode test`, used by the e2e
 * server). In a production build the comparison is a literal, so everything
 * guarded by it is dead-code-eliminated.
 */
export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}

export function installTestHooks(api: Omit<Vidi6TestApi, 'connectionState'> | null): void {
  if (!isTestMode()) return;
  if (api) {
    window.__vidi6 = {
      ...api,
      get connectionState(): ConnectionState {
        return (window as unknown as { __vidi6ConnectionState?: ConnectionState }).__vidi6ConnectionState ?? 'connecting';
      },
    };
  } else if (window.__vidi6) {
    delete window.__vidi6;
  }
}

/** Set the connection state on window for e2e tests. */
export function setTestConnectionState(state: ConnectionState): void {
  if (!isTestMode()) return;
  (window as unknown as { __vidi6ConnectionState?: ConnectionState }).__vidi6ConnectionState = state;
}
