import type { Camera } from './camera';
import type { CameraStore } from './useCamera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Test-only hooks for the e2e suite, published as `window.__vidi6`.
 * `TEST_HOOKS_ENABLED` is a constant after the Vite build, so in production
 * builds every function here returns immediately and `window.__vidi6` never
 * exists.
 *
 * - `setCamera` / `getCamera`: jump the camera to an exact location (dragging
 *   a million pixels is not practical).
 * - `connectionState`: the last state `connectBoard` mapped (TC-29).
 * - `dropSockets()`: close the live board sockets, which is how an e2e test
 *   makes the client notice a network drop immediately instead of waiting for
 *   the WebSocket handshake to time out.
 */

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  connectionState?: ConnectionState;
  dropSockets(): void;
  socketCount(): number;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const TEST_HOOKS_ENABLED = import.meta.env.MODE === 'test';

let activeStore: CameraStore | null = null;
let activeConnection: ConnectionState | null = null;
const liveSockets = new Set<WebSocket>();

function publish(): void {
  if (!TEST_HOOKS_ENABLED) return;
  window.__vidi6 = {
    setCamera: (camera: Camera) => activeStore?.setCamera(camera),
    getCamera: () => activeStore?.getSnapshot().camera ?? { x: 0, y: 0, zoom: 1 },
    ...(activeConnection === null ? {} : { connectionState: activeConnection }),
    dropSockets: () => {
      for (const socket of [...liveSockets]) socket.close();
    },
    // A soak asserts this never grows while the board is idle, i.e. the provider
    // is not reconnecting behind its client's back, and `destroy()` leaves none
    // open.
    socketCount: () => liveSockets.size,
  };
}

export function registerCameraStore(store: CameraStore): void {
  if (!TEST_HOOKS_ENABLED) return;
  activeStore = store;
  publish();
}

export function unregisterCameraStore(store: CameraStore): void {
  if (!TEST_HOOKS_ENABLED) return;
  if (activeStore === store) {
    activeStore = null;
    publish();
  }
}

/** Mirror the mapped connection state for e2e assertions (TC-29). */
export function reportConnectionState(state: ConnectionState): void {
  if (!TEST_HOOKS_ENABLED) return;
  activeConnection = state;
  publish();
}

/**
 * A `WebSocket` subclass recording every socket the provider opens, or
 * `undefined` in production builds. Given to `WebsocketProvider` as
 * `WebSocketPolyfill`.
 */
export function recordingWebSocket(): typeof WebSocket | undefined {
  if (!TEST_HOOKS_ENABLED) return undefined;
  return class RecordingWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      liveSockets.add(this);
      this.addEventListener('close', () => liveSockets.delete(this), { once: true });
    }
  };
}
