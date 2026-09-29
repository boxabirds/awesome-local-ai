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
import { CLOSE_BOARD_LOAD_FAILED } from 'src/shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Editing is allowed in every state except `load_failed`: a board that cannot
 * be loaded from storage is read-only (no local edits, which would never be
 * served). `reconnecting` keeps the board editable — unsaved changes are
 * re-sent on reconnect.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

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
  onClose: (code: number | null) => void;
  destroy: () => void;
} {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  // Sticky: once the board fails to load (close 4500) we stay `load_failed` —
  // showing the red badge and locking edits — until a successful sync.
  let loadFailed = false;
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
    // A load-failed board keeps retrying in the background; the badge must
    // stay red (and edits locked) until a sync succeeds, so ignore status.
    if (loadFailed) return;
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
      loadFailed = false; // a successful sync clears the load-failure lock
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

  const onClose = (code: number | null) => {
    // A `null` code is a local close (provider.disconnect / watchdog) — not a
    // server signal, so it is handled by the `status` events.
    if (code === null) return;
    if (code === CLOSE_BOARD_LOAD_FAILED) {
      loadFailed = true;
      clearConfirm();
      set('load_failed');
      return;
    }
    // Storage failure (1011) and any other server close: the board is still
    // readable and the provider reconnects, so map to `reconnecting`.
    if (loadFailed) return; // do not override the load-failure lock
    if (everSynced) {
      clearConfirm();
      set('reconnecting');
    }
  };

  return {
    onStatus,
    onSync,
    onClose,
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
      // y-websocket treats 4400-4499 as a permanent close, which would stop the
      // retries a load-failed board (4500) depends on to recover. Always retry:
      // a failing board keeps reconnecting in the background until it loads.
      shouldReconnect: () => true,
    },
  );

  const machine = createConnectionStateMachine(onState);
  provider.on('status', (e) => machine.onStatus(e.status));
  provider.on('sync', (s) => machine.onSync(s));
  // Close code 4500 (board load failed) → `load_failed`; 1011 / other →
  // `reconnecting`. `event` is null on a local close.
  provider.on('connection-close', (event) => {
    machine.onClose(event ? event.code : null);
  });

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
