// The browser's network layer. It wraps the stock `y-websocket` provider, which
// is already the exact wire protocol the BoardRoom relays: it sends SyncStep1 on
// connect, broadcasts local updates, and applies what comes back to the same
// Y.Doc the app renders. On top of that we derive a small UI state machine from
// the provider's `status` and `sync` events, and keep an otherwise idle socket
// alive with a single local awareness state.
//
// `suppressLocalBroadcastUpdate` is left `false` so local edits go straight out
// on the socket; the room never echoes an update back to its author, so the
// author learns its own edit only by applying it locally, exactly as the design
// describes.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { COLLAB_ENDPOINT } from './endpoint';

/**
 * What the badge can show. `connected` is the steady live state and renders no
 * badge; `confirmed` is the brief green "Connected" shown right after a
 * reconnect settles; `connecting` is first load; `reconnecting` is a lost link;
 * `load_failed` is the room telling us it could not read this board at all,
 * which is a different thing from a link being down and says so.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** Whether the board takes edits. Only a board that could not be read refuses
 *  them: a link that is down keeps taking edits into the local document, which is
 *  what makes catching up afterwards possible. */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** The one field of a close event the badge reads, named so a test can hand over
 *  a plain object instead of a browser event. */
export interface CloseEventLike {
  code: number;
}

/** The slice of the provider `mapConnectionState` observes, kept minimal so the
 *  pure state machine can be driven by a fake emitter in a component test. */
export interface ConnectionEmitter {
  on(name: 'status', handler: (event: { status: string }) => void): void;
  on(name: 'sync', handler: (state: boolean) => void): void;
  on(name: 'connection-close', handler: (event: CloseEventLike | null) => void): void;
  off(name: 'status', handler: (event: { status: string }) => void): void;
  off(name: 'sync', handler: (state: boolean) => void): void;
  off(name: 'connection-close', handler: (event: CloseEventLike | null) => void): void;
}

/**
 * Translate provider `status` / `sync` events into `ConnectionState`, calling
 * `onState` on every change, and return an unsubscribe function.
 *
 * The rules are exactly the design's state table:
 *   connecting before the first sync  -> "connecting"
 *   connected + synced (first time)   -> "connected"   (badge hides)
 *   disconnected once we were synced  -> "reconnecting"
 *   a reconnect that resyncs          -> "confirmed" for CONNECTED_CONFIRMATION_MS
 *                                        then "connected"
 *   closed with CLOSE_BOARD_LOAD_FAILED -> "load_failed"
 *
 * `load_failed` is held until a sync succeeds, and nothing else replaces it. The
 * provider keeps trying in the background - the room's own close code is in the
 * range that says "worth another go" - and a page that flickered back to
 * "Reconnecting…" between attempts would be claiming the board might arrive at any
 * moment, when the room has just said it could not read it. The first successful
 * sync is what ends it: the board is there, so the badge goes away.
 *
 * A close code in 4400-4499 is the provider's own signal to stop reconnecting (it
 * treats that range as permanent and emits `closed`); this app never sends one, so
 * the only close code with a meaning here is the load-failure one.
 *
 * The confirmation timeout is a plain `setTimeout`, so a test can drive the
 * whole badge with fake timers.
 */
export function mapConnectionState(
  emitter: ConnectionEmitter,
  onState: (state: ConnectionState) => void,
): () => void {
  let everSynced = false;
  let state: ConnectionState = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: ConnectionState): void => {
    if (next === state) return;
    if (state === 'load_failed' && next !== 'connected') return; // held until the board arrives
    state = next;
    onState(next);
  };

  const clearConfirmation = (): void => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  const beginConfirmation = (): void => {
    clearConfirmation();
    emit('confirmed');
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      emit('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  const onClose = (event: CloseEventLike | null): void => {
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) {
      // Told to us in as many words by the room: this board could not be read.
      clearConfirmation();
      emit('load_failed');
    }
    // Any other code is an ordinary disconnect; the provider decides whether to go
    // on trying and the `status` events say what it is doing.
  };

  const onStatus = ({ status }: { status: string }): void => {
    if (status === 'disconnected') {
      // A lost link: reconnecting if we had ever synced, otherwise still the
      // first attempt. Any pending confirmation is now meaningless.
      clearConfirmation();
      emit(everSynced ? 'reconnecting' : 'connecting');
    } else if (status === 'connecting') {
      if (state !== 'confirmed') emit(everSynced ? 'reconnecting' : 'connecting');
    } else if (status === 'connected') {
      if (!everSynced) {
        // Socket is open but we have not synced yet; the first load continues.
        emit('connecting');
      } else if (state !== 'confirmed') {
        // A reconnect: treat the fresh connection as the badge settling.
        beginConfirmation();
      }
    }
  };

  const onSync = (synced: boolean): void => {
    if (!synced) return;
    if (state === 'load_failed') {
      // The board is here after all - the room read it on a retry. Go straight to
      // the quiet state rather than celebrating a reconnect we were never told about.
      everSynced = true;
      emit('connected');
      return;
    }
    if (!everSynced) {
      everSynced = true;
      emit('connected');
    } else if (state !== 'confirmed') {
      beginConfirmation();
    }
  };

  emitter.on('status', onStatus);
  emitter.on('sync', onSync);
  emitter.on('connection-close', onClose);
  emit('connecting');

  return () => {
    clearConfirmation();
    emitter.off('status', onStatus);
    emitter.off('sync', onSync);
    emitter.off('connection-close', onClose);
  };
}

/** The room URL base: an explicit endpoint (the standalone server in some e2e
 *  runs) or the Worker route derived from the page's own origin. */
function collabServerUrl(): string {
  if (COLLAB_ENDPOINT) return COLLAB_ENDPOINT.replace(/\/$/, '');
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/rooms`;
}

export interface BoardConnection {
  /** The provider's awareness, exposed so a caller can drop local state. */
  awareness: WebsocketProvider['awareness'];
  /**
   * Forcibly close / re-open the socket. e2e uses these to simulate a real
   * dropped link deterministically (Playwright's `setOffline` does not reset an
   * already-open WebSocket), exercising the same provider disconnect/reconnect/
   * resync path the badge and catch-up tests assert.
   */
  drop(): void;
  restore(): void;
  /** True while the provider holds a local awareness state (presence alive). */
  awarenessPresent(): boolean;
  /** How many times the provider has begun (re)connecting; grows on reconnects. */
  reconnectAttempts(): number;
  destroy(): void;
}

/**
 * Attach `doc` to its room and report connection state through `onState`. The
 * caller keeps the same `Y.Doc`; destroying the connection never touches it, so
 * unsynced local edits survive a disconnect (and are sent on the next connect).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(collabServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const unsubscribe = mapConnectionState(
    provider as unknown as ConnectionEmitter,
    onState,
  );

  // The provider only rebroadcasts local awareness on a connect when a local
  // state exists. Giving it an (empty) local state makes every (re)connect send
  // an awareness update, which the room relays back to us too — that echo is the
  // only inbound traffic on an idle board and is what keeps the socket open past
  // the provider's 30s no-message reconnect timeout (see TC-29).
  const keepAlive = ({ status }: { status: string }): void => {
    if (status === 'connected') provider.awareness.setLocalState({});
  };
  provider.on('status', keepAlive);
  provider.awareness.setLocalState({});

  // Count (re)connects so the nightly soak can prove `destroy()` stops the
  // provider trying to reconnect after a context closes.
  let connectEvents = 0;
  const countStatus = ({ status }: { status: string }): void => {
    if (status === 'connecting') connectEvents += 1;
  };
  provider.on('status', countStatus);

  return {
    awareness: provider.awareness,
    drop(): void {
      provider.disconnect();
    },
    restore(): void {
      provider.connect();
    },
    awarenessPresent(): boolean {
      return provider.awareness.getLocalState() !== null;
    },
    reconnectAttempts(): number {
      return connectEvents;
    },
    destroy(): void {
      provider.off('status', keepAlive);
      provider.off('status', countStatus);
      provider.awareness.setLocalState(null);
      unsubscribe();
      provider.disconnect();
      provider.destroy();
    },
  };
}
