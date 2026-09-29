// Client board connection (see spec: sync.client).
//
// `connectBoard` attaches a y-websocket WebsocketProvider to the board doc
// and maps its status events onto the four UI connection states. The mapping
// lives in `createConnectionStateMachine` so it can be tested with a fake
// event emitter and fake timers (TC-19 to TC-21).
//
// State mapping:
//   provider 'connecting' (before first sync)      -> 'connecting'
//   first 'connected'                              -> 'connected'
//   'disconnected'/'connecting' after having been  -> 'reconnecting'
//   re-'connected'                                 -> 'confirmed' for
//   CONNECTED_CONFIRMATION_MS, then 'connected'
//
// Selection/editing are local React state (useSelection) and are never
// written to the doc (live.local_selection).

import { AWARENESS_HEARTBEAT_MS, CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import * as Y from 'yjs';
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { WebsocketProvider } from 'y-websocket';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionStateMachine {
  /** Feed a provider status event. */
  status(s: ProviderStatus): void;
  /** The provider closed with CLOSE_BOARD_LOAD_FAILED: the board is unreadable. */
  loadFailed(): void;
  /** Cancel any pending confirmation timer. */
  destroy(): void;
}

/**
 * Pure status mapping, independent of WebsocketProvider (unit-testable with
 * fake timers). Emits the current UI state on every transition.
 */
export function createConnectionStateMachine(
  onState: (state: ConnectionState) => void,
  confirmationMs: number = CONNECTED_CONFIRMATION_MS,
): ConnectionStateMachine {
  let state: ConnectionState = 'connecting';
  let everConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: ConnectionState) => {
    state = next;
    onState(next);
  };
  const clearConfirmation = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  return {
    status(providerStatus: ProviderStatus) {
      if (providerStatus === 'connected') {
        if (everConnected) {
          // Reconnected: green "Connected" for confirmationMs, then hide.
          clearConfirmation();
          emit('confirmed');
          confirmationTimer = setTimeout(() => {
            confirmationTimer = null;
            if (state === 'confirmed') emit('connected');
          }, confirmationMs);
        } else {
          everConnected = true;
          emit('connected');
        }
      } else if (providerStatus === 'disconnected' || providerStatus === 'connecting') {
        // The close code already owns the load_failed state: the status event
        // of the same close must not downgrade it to reconnecting.
        if (state === 'load_failed') return;
        if (everConnected) {
          clearConfirmation();
          emit('reconnecting');
        } else {
          emit('connecting');
        }
      }
    },
    loadFailed() {
      clearConfirmation();
      if (state !== 'load_failed') emit('load_failed');
    },

    destroy() {
      clearConfirmation();
    },
  };
}

export interface BoardConnection {
  destroy(): void;
}

/**
 * Attach a WebsocketProvider to `doc` for `boardId`.
 *
 * `disableBc: true` so same-browser tabs cannot sync around the server
 * (tests must exercise the server path). An awareness heartbeat is sent
 * every AWARENESS_HEARTBEAT_MS: the room relays awareness frames back to the
 * sender, which keeps the provider's 30 s no-message watchdog from dropping
 * an idle connection (TC-29).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${window.location.host}/api/rooms`;
  const machine = createConnectionStateMachine(onState);
  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  provider.on('status', (event) => machine.status(event.status));

  // A 4500 close means the board's saved state is unreadable: show the red
  // "couldn't be loaded" badge and gate editing. 1011 (storage failure) stays
  // 'reconnecting': the board is readable and changes retry on reconnect.
  // The provider keeps retrying (4500 is not in the 4400-4499 permanent
  // range); the first successful sync switches back to connected.
  provider.on('connection-close', (event) => {
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) {
      machine.loadFailed();
    }
  });

  // Flush the full doc update on every connect (offline catch-up).
  // y-websocket only sends a state vector (SyncStep1) on open; local edits
  // made while offline were never sent (their writeUpdate was dropped), so
  // the room would never see them. Sending the full update here guarantees
  // the server receives every local change (spec: live.catch_up).
  provider.on('status', (event) => {
    if (event.status !== 'connected') return;
    const ws = provider.ws;
    if (ws === null || ws.readyState !== 1) return;
    const encoder = createEncoder();
    writeVarUint(encoder, 0); // SYNC frame
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    ws.send(toUint8Array(encoder));
  });

  // Awareness heartbeat (see file header).
  const setHeartbeat = () => {
    provider.awareness.setLocalStateField('lastSeen', Date.now());
  };
  provider.awareness.setLocalState({ app: 'vidi6', lastSeen: Date.now() });
  const heartbeat = setInterval(setHeartbeat, AWARENESS_HEARTBEAT_MS);

  machine.status('connecting');
  return {
    destroy() {
      clearInterval(heartbeat);
      machine.destroy();
      provider.destroy();
    },
  };
}
