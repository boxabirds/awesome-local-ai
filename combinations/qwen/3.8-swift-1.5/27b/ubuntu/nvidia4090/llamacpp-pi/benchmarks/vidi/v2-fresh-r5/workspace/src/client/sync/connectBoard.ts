/**
 * Client connection to the board room. Wraps the y-websocket
 * `WebsocketProvider` and maps its status/sync events onto the app's
 * `ConnectionState` (drives the ConnectionStatus badge).
 *
 * State mapping:
 * - `connecting`   — before the first successful sync.
 * - `connected`    — socket open and synced (steady state; badge hidden).
 * - `reconnecting` — disconnected after having been connected (badge amber).
 * - `confirmed`    — re-synced after a reconnect; held for
 *   CONNECTED_CONFIRMATION_MS, then back to `connected` (badge green).
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The y-websocket provider's raw status values. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** The observable state machine used by `connectBoard` (and the tests). */
export interface ConnectionController {
  onProviderStatus(status: ProviderStatus): void;
  onProviderSync(sync: boolean): void;
  dispose(): void;
}

/**
 * Deterministic connection-state machine. Pure apart from the confirmation
 * timer, so tests can drive it with a fake provider emitter and fake timers.
 */
export function createConnectionController(
  onState: (s: ConnectionState) => void,
): ConnectionController {
  let providerStatus: ProviderStatus = 'connecting';
  let synced = false;
  let hasConnected = false;
  let current: ConnectionState = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const set = (s: ConnectionState) => {
    if (s !== current) {
      current = s;
      onState(s);
    }
  };
  const clearConfirm = () => {
    if (confirmTimer !== undefined) {
      clearTimeout(confirmTimer);
      confirmTimer = undefined;
    }
  };
  const onEstablished = () => {
    clearConfirm();
    if (!hasConnected) {
      hasConnected = true;
      set('connected');
    } else {
      // Reconnection: green confirmation for CONNECTED_CONFIRMATION_MS.
      set('confirmed');
      confirmTimer = setTimeout(() => {
        confirmTimer = undefined;
        set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  return {
    onProviderStatus(status: ProviderStatus) {
      providerStatus = status;
      clearConfirm();
      if (status === 'connected' && synced) {
        onEstablished();
      } else if (status === 'disconnected') {
        set(hasConnected ? 'reconnecting' : 'connecting');
      } else if (!hasConnected) {
        set('connecting');
      }
    },
    onProviderSync(sync: boolean) {
      synced = sync;
      if (providerStatus === 'connected' && sync) {
        onEstablished();
      }
    },
    dispose() {
      clearConfirm();
    },
  };
}

/**
 * Attach a y-websocket provider to `doc` for `/api/rooms/<boardId>` and
 * report the mapped connection state. `disableBc: true` so tabs in the same
 * browser cannot sync around the server. Returns `destroy()` for unmount.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(
    `${protocol}://${window.location.host}/api/rooms`,
    boardId,
    doc,
    { maxBackoffTime: RECONNECT_MAX_BACKOFF_MS, disableBc: true },
  );

  const controller = createConnectionController(onState);
  const onStatus = (event: { status: ProviderStatus }) =>
    controller.onProviderStatus(event.status);
  const onSync = (sync: boolean) => controller.onProviderSync(sync);
  provider.on('status', onStatus);
  provider.on('sync', onSync);

  // Test-only: let e2e simulate a network break (see testHooks).
  const hook = (window as { __vidi6?: { dropConnection?: () => void } }).__vidi6;
  if (hook) {
    hook.dropConnection = () => {
      provider.ws?.close();
    };
  }

  return {
    destroy() {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      controller.dispose();
      provider.destroy();
    },
  };
}
