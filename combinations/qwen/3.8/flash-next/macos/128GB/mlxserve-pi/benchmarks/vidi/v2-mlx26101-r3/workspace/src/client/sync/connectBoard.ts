import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { registerConnectionHook } from '../testHooks';

/**
 * What this tab knows about its connection to the room that holds the board.
 *
 * `connecting` is the first load, before the board has ever been seen. `connected` is the
 * normal state and is not shown at all. `reconnecting` means a connection this tab had is
 * gone and the provider is trying again with backoff; the board stays fully editable in the
 * meantime, because the edits go into the local document either way. `confirmed` is the
 * short lived state right after a reconnection has synced again - the tab does not claim to
 * be back until the room has actually caught up with it.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  /** Hang up. Called when the component goes away or the tab moves to another board. */
  destroy(): void;
}

/**
 * Where rooms live: the same origin that served this page, so the Worker that answers
 * `/api/rooms/<boardId>` is the one serving the board. `WebsocketProvider` appends the room
 * name to this, which is why the path ends at `/api/rooms`.
 */
function serverUrl(): string {
  const secure = window.location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${window.location.host}/api/rooms`;
}

/**
 * Connect a board document to its room, and say what the connection is doing.
 *
 * Everything about the syncing itself is the provider's: the initial exchange of state,
 * sending local edits, retrying with exponential backoff up to
 * {@link RECONNECT_MAX_BACKOFF_MS}. What this function adds is the small translation from
 * provider events to the four states the badge knows about - in particular that a socket
 * being open is not the same as the board being up to date, so `connected` waits for the
 * sync and not just for the handshake.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(serverUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Two tabs of the same browser must not copy each other behind the server's back: that
    // would let a test pass while the path through the Worker is broken.
    disableBc: true,
  });

  let state: ConnectionState = 'connecting';
  /** True once this tab has been in sync with the room at least once. */
  let everSynced = false;

  const report = (next: ConnectionState): void => {
    if (next === state) {
      return;
    }
    state = next;
    onState(next);
  };

  provider.on('status', (event) => {
    if (event.status === 'connected') {
      // Open, but nothing has been exchanged yet; the `sync` event says when the board is real.
      return;
    }
    report(everSynced ? 'reconnecting' : 'connecting');
  });

  provider.on('sync', (synced: boolean) => {
    if (!synced) {
      return;
    }
    everSynced = true;
    // Coming back from an interruption is worth showing; the first sync of a first load is
    // simply the board appearing.
    report(state === 'reconnecting' ? 'confirmed' : 'connected');
  });

  // The e2e suite has to be able to say "this person's network went away". Nothing a test
  // can do to a browser drops a connection that is already open - offline emulation only
  // stops new ones - so the test asks for the socket to die the same death here. Combined
  // with blocking the way back in, the client then notices on its own, retries on its own
  // backoff, and catches up on its own, which is the behaviour under test.
  const stopHook = registerConnectionHook(() => {
    provider.disconnect();
    provider.connect();
  });

  return {
    destroy() {
      stopHook();
      provider.destroy();
    },
  };
}
