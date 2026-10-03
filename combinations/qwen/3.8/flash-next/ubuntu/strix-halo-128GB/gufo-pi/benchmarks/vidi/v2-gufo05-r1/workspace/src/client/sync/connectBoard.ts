/**
 * The browser's half of live collaboration: one `y-websocket` provider per board,
 * and the four connection states the badge is drawn from.
 *
 * The provider does the talking (sync handshake, updates, reconnection with
 * exponential backoff). What is decided *here* is what the person sees while it
 * talks, because the provider's own words do not map onto them:
 *
 * | provider                     | shown         |
 * |------------------------------|---------------|
 * | connecting, never synced yet | "Connecting…"  |
 * | connected and synced         | nothing        |
 * | disconnected after syncing   | "Reconnecting…"|
 * | synced again after that      | "Connected" for CONNECTED_CONFIRMATION_MS |
 * | closed with 4500             | "This board couldn't be loaded. Retrying…" |
 *
 * `connected` from the provider only means the socket is open — the boards have
 * not met yet. That is why the two "we are in sync" transitions are read from the
 * `sync` event and the two "we are not" transitions from `status`. A reconnect
 * that has not synced yet still says "Reconnecting…", which is the truth: nobody
 * else has seen this screen's changes yet.
 *
 * Nothing here blocks the board. Edits go into the local `Y.Doc` in every state,
 * and on reconnection the provider's SyncStep2 delivers them along with anything
 * made while the connection was down (`live.catch_up`).
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { setTestConnectionState } from '../canvas/testHooks';

/**
 * What the badge says the connection is doing.
 *
 * `load_failed` is the odd one out: it is not about the connection working or not —
 * the socket works perfectly — but about the room refusing to hand over this board
 * because it could not be read from storage. It is the one state the board may not be
 * edited in (`canEdit`, in `ConnectionStatus`), because changes made here would be
 * thrown away.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** Anything the provider tells us that changes what the badge should say. */
export type ConnectionEvent =
  | { type: 'status'; status: 'connecting' | 'connected' | 'disconnected' }
  | { type: 'sync'; synced: boolean }
  /** The socket was closed by the other end; `code` is why (4500 = we cannot load this). */
  | { type: 'close'; code: number };

/**
 * The minimum the state machine needs to know about a connection: when it changes,
 * and whether the boards happen to be in sync already.
 *
 * `connectBoard` builds these from a `WebsocketProvider`. Tests build them from an
 * object they drive by hand, which is how the badge's timing — the green message that
 * goes away after CONNECTED_CONFIRMATION_MS — is tested without a WebSocket or a room.
 */
export interface ConnectionSignals {
  subscribe(listener: (event: ConnectionEvent) => void): () => void;
  synced(): boolean;
}

/**
 * Turn connection events into the four badge states, and call `onState` on each change.
 *
 * The rules, in words: a connection that has never synced is "connecting"; one that
 * breaks after having synced is "reconnecting" (a break *before* the first sync is
 * still "connecting", because that is what it looks like to the person); and a sync
 * that follows a break is "confirmed" for CONNECTED_CONFIRMATION_MS, then nothing.
 *
 * Returns the teardown.
 */
export function trackConnection(
  signals: ConnectionSignals,
  onState: (state: ConnectionState) => void,
): () => void {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const write = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    setTestConnectionState(next);
    onState(next);
  };

  const stopConfirmation = () => {
    if (confirmation !== null) {
      clearTimeout(confirmation);
      confirmation = null;
    }
  };

  const unsubscribe = signals.subscribe((event) => {
    if (event.type === 'close') {
      // Only the room's own "this board could not be loaded" counts. Any other close
      // — 1011, 1003, a dropped cable — is a connection problem, and the board stays
      // editable while it retries (story 4's TC-28).
      if (event.code === CLOSE_BOARD_LOAD_FAILED) {
        stopConfirmation();
        write('load_failed');
      }
      return;
    }
    if (state === 'load_failed') {
      // The room is refusing this board: a status change or a stale sync flag means
      // nothing while that is true. What does end the state is a real sync, below,
      // once the room has been repaired and lets this board in.
      if (event.type !== 'sync' || !event.synced) return;
      // The room let this board in after all: treat it the way a reconnection that
      // caught up is treated, so the person is told the board is live again.
      everSynced = true;
    }
    if (event.type === 'status') {
      // Only a connection that was cut counts as "reconnecting": one that has not
      // started yet is still "connecting", and a retry while already reconnecting
      // changes nothing the person can see.
      if (event.status === 'disconnected' && everSynced) {
        stopConfirmation(); // the green message would be a lie now
        write('reconnecting');
      }
      return;
    }
    if (!event.synced) return;
    const wasReconnecting = everSynced;
    everSynced = true;
    stopConfirmation();
    if (!wasReconnecting) {
      write('connected');
      return;
    }
    // The board has caught up. Say so for a moment, then stand out of the way.
    write('confirmed');
    confirmation = setTimeout(() => {
      confirmation = null;
      write('connected');
    }, CONNECTED_CONFIRMATION_MS);
  });

  // A board with nothing on it syncs before anyone asks, so the current answer is
  // part of the deal.
  if (signals.synced()) {
    onState('connected');
    state = 'connected';
    everSynced = true;
    setTestConnectionState(state);
  } else {
    setTestConnectionState(state);
  }

  return () => {
    stopConfirmation();
    unsubscribe();
  };
}

export interface BoardConnection {
  /** Tear the provider down: called on unmount and when the board changes. */
  destroy(): void;
  /**
   * Drop and re-establish the connection without touching the network settings.
   * The e2e tests use these to stand in for a Wi-Fi that stops answering: the
   * provider sees a close, then reconnects, exactly as it would on a real drop.
   */
  goOffline(): void;
  goOnline(): void;
}

/** Where the rooms live: this same host, its own WebSocket scheme. */
export function roomServer(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/rooms`;
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomServer(), boardId, doc, {
    // The setting is the ceiling of the provider's exponential backoff, so a long
    // outage is retried at most every RECONNECT_MAX_BACKOFF_MS.
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Two tabs of the same browser must see each other *through the room*, not
    // around it: otherwise a test (or a workshop) could look collaborative while
    // the server relays nothing.
    disableBc: true,
  });

  const signals: ConnectionSignals = {
    subscribe(listener) {
      const onStatus = ({ status }: { status: string }) => {
        if (status === 'connecting' || status === 'connected' || status === 'disconnected') {
          listener({ type: 'status', status });
        }
      };
      const onSync = (synced: boolean) => {
        listener({ type: 'sync', synced });
      };
      // The room says "this board could not be loaded" by closing the socket with its
      // own code, and nothing else: this is the only place that hears it.
      const onClose = (event: CloseEvent | null) => {
        if (event) listener({ type: 'close', code: event.code });
      };
      provider.on('status', onStatus);
      provider.on('sync', onSync);
      provider.on('connection-close', onClose);
      return () => {
        provider.off('status', onStatus);
        provider.off('sync', onSync);
        provider.off('connection-close', onClose);
      };
    },
    synced: () => provider.synced,
  };

  const stop = trackConnection(signals, onState);

  return {
    destroy() {
      stop();
      provider.destroy();
    },
    goOffline() {
      provider.disconnect();
    },
    goOnline() {
      provider.connect();
    },
  };
}
