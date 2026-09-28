/**
 * Story 3: client connection.
 *
 * Attaches a y-websocket `WebsocketProvider` to the board doc and maps the
 * provider's `status` + `sync` events to a small connection state machine the
 * status badge renders:
 *
 *   connecting  → connected          (first load)
 *   connected   → reconnecting       (socket closed / timeout, having synced)
 *   reconnecting → confirmed → connected  (re-synced; confirmed shown for
 *                 CONNECTED_CONFIRMATION_MS, then hidden)
 *
 * BroadcastChannel is disabled (`disableBc: true`) so same-browser tabs cannot
 * sync around the server — the server path is always exercised.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from 'src/shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  destroy: () => void;
  /**
   * Drop the sync connection (test seam for the flaky-Wi-Fi catch-up path).
   * In headless browsers `context.setOffline(true)` does not reliably close an
   * open WebSocket, so we drive the provider directly: `dropSocket` calls
   * `provider.disconnect()` (emits `disconnected` → state `reconnecting`), and
   * `resumeSocket` calls `provider.connect()` so it reconnects and re-syncs.
   */
  dropSocket: () => void;
  resumeSocket: () => void;
}

/** `ws://`/`wss://` origin of the current page, for the WebSocket URL. */
export function wsOrigin(): string {
  const proto =
    typeof window !== 'undefined' && window.location?.protocol === 'https:'
      ? 'wss'
      : 'ws';
  const host = typeof window !== 'undefined' ? window.location.host : '';
  return `${proto}://${host}`;
}

export type ProviderStatus = 'connected' | 'disconnected' | 'connecting';

/**
 * Pure connection state machine, decoupled from the provider so it can be
 * driven by a fake event emitter + fake timers in tests. Feeding it the
 * provider's `status`/`sync` events yields the mapped ConnectionState.
 *
 *   connecting    -> connected         (first load)
 *   connected     -> reconnecting      (socket dropped after the first sync)
 *   reconnecting  -> confirmed -> connected
 *                   (re-synced; confirmed shown for CONNECTED_CONFIRMATION_MS)
 */
export function createConnectionStateMachine(
  onState: (s: ConnectionState) => void,
): {
  onStatus: (status: ProviderStatus) => void;
  onSync: (synced: boolean) => void;
  destroy: () => void;
} {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };

  const clearConfirm = () => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  const onStatus = (status: ProviderStatus) => {
    if (status === 'disconnected') {
      clearConfirm();
      if (everSynced) set('reconnecting');
    } else if (status === 'connecting') {
      clearConfirm();
      set(everSynced ? 'reconnecting' : 'connecting');
    }
    // 'connected' only means the socket is open; we wait for `sync` to flip.
  };

  const onSync = (synced: boolean) => {
    if (synced) {
      if (!everSynced) {
        everSynced = true;
        set('connected');
      } else {
        set('confirmed');
        clearConfirm();
        confirmTimer = setTimeout(() => {
          confirmTimer = null;
          set('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    } else if (everSynced) {
      clearConfirm();
      set('reconnecting');
    }
  };

  return {
    onStatus,
    onSync,
    destroy: () => clearConfirm(),
  };
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(
    `${wsOrigin()}/api/rooms`,
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
    },
  );

  const machine = createConnectionStateMachine(onState);
  provider.on('status', (e) => machine.onStatus(e.status));
  provider.on('sync', (s) => machine.onSync(s));

  return {
    destroy: () => {
      machine.destroy();
      provider.destroy();
    },
    dropSocket: () => {
      provider.disconnect();
    },
    resumeSocket: () => {
      provider.connect();
    },
  };
}
