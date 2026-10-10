import type { BoardConnection, ConnectionState } from '../sync/connectBoard';
import type { Camera } from './camera';

/**
 * Test-only hooks. Call sites guard with `import.meta.env.MODE === 'test'` so
 * Vite replaces the mode with a literal in production builds and drops the code
 * entirely (see `npm run build` vs `npm run build:test`).
 */
export interface BoardTestApi {
  /** Jump the camera anywhere, e.g. 1,000,000 board units away (TC-26, TC-27). */
  setCamera(camera: Camera): void;
  /** The camera the board is currently rendering. */
  getCamera(): Camera;
  /** Return to the standard view (100%, board start centred). */
  reset(): void;
  /**
   * The connection state the badge is showing (live.status). Nightly e2e
   * watches it while nothing is happening (TC-29), which the badge text alone
   * cannot tell: hidden is also "normal".
   */
  connectionState?: ConnectionState;
  /**
   * Close the live socket as if the wire had been cut (TC-27). Chromium's
   * offline emulation leaves an established websocket alone, so a test that
   * wants an outage has to break the socket itself - next to switching the
   * network off, so that reconnecting fails too until the network is back.
   */
  connectionDrop?: () => void;
}

declare global {
  interface Window {
    __vidi6?: BoardTestApi;
  }
}

/**
 * The test API object, created on first use. It is filled in piece by piece —
 * the camera hooks and the board's connection state come from different
 * effects — which is why an empty object is created cast as the full type: any
 * reader runs after the whole board (both publishers) has mounted.
 */
function testApi(): BoardTestApi {
  window.__vidi6 ??= {} as BoardTestApi;
  return window.__vidi6;
}

export function installTestHooks(api: BoardTestApi): () => void {
  // Merged, not assigned: the last hook to mount must not drop what the others published.
  Object.assign(testApi(), api);
  return () => {
    delete window.__vidi6;
  };
}

/** Publish the board's connection state for tests that watch it (TC-29). */
export function publishConnectionState(state: ConnectionState): void {
  testApi().connectionState = state;
}

/** Publish the live connection for tests that need an outage (TC-27). */
export function publishConnection(live: BoardConnection | null): void {
  testApi().connectionDrop = live === null ? undefined : () => live.drop();
}
