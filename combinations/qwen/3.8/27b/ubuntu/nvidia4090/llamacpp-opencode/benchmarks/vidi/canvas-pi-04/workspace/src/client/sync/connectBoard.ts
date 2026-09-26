// Story 3: live sync over websockets (anchors: sync.connect, sync.connection_state).
//
// connectBoard wires a Y.Doc to its board room with y-websocket's
// WebsocketProvider. The provider already implements the hard parts:
// exponential-backoff reconnects (capped by maxBackoffTime), automatic
// resync after reconnect, and Awareness with a liveness watchdog. What this
// module owns is the USER-FACING connection state (PRD live.badge):
//
//   connecting --first sync--> connected
//   connected  --socket down--> reconnecting --re-sync--> confirmed
//   confirmed  --CONNECTED_CONFIRMATION_MS elapse--> connected
//   connecting --socket down--> connecting (initial attempt failing; retry)
//   reconnecting --socket down--> reconnecting (stays; backoff continues)
//
// "connected" means the board is live: the doc has synced and (after a
// reconnect) has stayed up for the confirmation window. While
// "reconnecting", local edits still go into the doc and reach the room when
// the provider resyncs — the board is never locked out (PRD live.badge).

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Whether the board accepts edits in the given connection state. Editing is
 * locked out ONLY while the board could not be loaded (PRD persist.badge):
 * a reconnect (1011 / network) keeps the board editable because local edits
 * are retried once the socket returns.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export interface ConnectionStatusObserver {
  /** Feed one provider `status` event: { status: 'connecting' | 'connected' | 'disconnected' }. */
  onStatus(event: { status: 'connecting' | 'connected' | 'disconnected' }): void;
  /** Feed one provider `sync` event: [synced]. */
  onSync(event: [boolean]): void;
  /** Feed one provider `connection-close` close code. */
  onConnectionClose(event: { code: number }): void;
  /** Release any pending confirmation timer. */
  destroy(): void;
}

/**
 * The pure state machine over y-websocket provider events. Exported so the
 * badge logic is unit-testable with a fake emitter and fake timers — no
 * network involved.
 */
export function observeConnectionStatus(
  onState: (state: ConnectionState) => void,
): ConnectionStatusObserver {
  let state: ConnectionState = 'connecting';
  let hasBeenSynced = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    onState(next);
  };

  onState('connecting'); // emit the initial state immediately

  const onStatus: ConnectionStatusObserver['onStatus'] = ({ status }) => {
    if (status !== 'disconnected') return; // socket open ≠ doc synced
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    // Before the first sync a downed socket is just the initial connect
    // retrying; after we were live it means reconnecting. A load_failed
    // board keeps retrying but stays locked out (it is still failing).
    if (hasBeenSynced && state !== 'load_failed') setState('reconnecting');
  };

  const onSync: ConnectionStatusObserver['onSync'] = ([synced]) => {
    if (!synced) return;
    if (state === 'load_failed') {
      // A retry got through and synced: the board is live and editable
      // again, with no page reload (persist.client_status).
      hasBeenSynced = true;
      setState('connected');
      return;
    }
    if (!hasBeenSynced) {
      hasBeenSynced = true;
      setState('connected');
      return;
    }
    if (state === 'reconnecting') {
      // Re-synced: confirm for the window, then go quiet.
      setState('confirmed');
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        setState('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  const onConnectionClose: ConnectionStatusObserver['onConnectionClose'] = ({ code }) => {
    if (code === CLOSE_BOARD_LOAD_FAILED) {
      // The room could not load the board: lock editing and show the
      // load-failed message. The provider keeps retrying on its backoff;
      // the first successful sync switches back to "connected".
      if (confirmTimer !== null) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      setState('load_failed');
      return;
    }
    // Any other close (1011 storage failure, network drop, our own teardown)
    // is just a disconnect: reconnecting if we were live, retrying if not.
    onStatus({ status: 'disconnected' });
  };

  return {
    onStatus,
    onSync,
    onConnectionClose,
    destroy(): void {
      if (confirmTimer !== null) clearTimeout(confirmTimer);
    },
  };
}

/**
 * Test-only mirror of the live state, read by the `window.__vidi6` hook so
 * E2E tests can assert on the mapped state (absent from production builds —
 * the hook itself is never registered there).
 */
let testConnectionState: ConnectionState = 'connecting';
export function getTestConnectionState(): ConnectionState {
  return testConnectionState;
}

/** Test-only handle to the live provider (see `forceDisconnect` below). */
let testProvider: WebsocketProvider | null = null;
export function getTestProvider(): WebsocketProvider | null {
  return testProvider;
}

/**
 * Connect `doc` to the room for `boardId`. The WebsocketProvider owns the
 * socket, the backoff and the awareness; the returned handle tears all of
 * it down (no reconnect attempts are scheduled afterwards).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): { destroy(): void } {
  testConnectionState = 'connecting';
  const observer = observeConnectionStatus((state) => {
    testConnectionState = state;
    onState(state);
  });
  const origin = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
  const provider = (testProvider = new WebsocketProvider(`${origin}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // One tab per board per user in this app; BroadcastChannel would only
    // add local cross-tab echoes that muddy the live assertions.
    disableBc: true,
  }));
  provider.on('status', (ev: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    observer.onStatus(ev);
  });
  provider.on('sync', (synced: boolean) => {
    observer.onSync([synced]);
  });
  // Close code: 4500 means the room could not load the board (load_failed);
  // everything else is an ordinary disconnect (reconnecting).
  provider.on('connection-close', (event: CloseEvent | null) => {
    observer.onConnectionClose({ code: event === null ? 0 : event.code });
  });
  return {
    destroy(): void {
      observer.destroy();
      provider.destroy();
      if (testProvider === provider) testProvider = null;
    },
  };
}
