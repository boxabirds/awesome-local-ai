import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
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
 *
 * `load_failed` is the one state that is not about the connection: it is the room saying the
 * board could not be read out of storage. Nothing this tab can do about that, and what is on
 * screen may not be the board, so it is the one state that stops the user editing.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

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
 * provider events to the states the badge knows about - in particular that a socket
 * being open is not the same as the board being up to date, so `connected` waits for the
 * sync and not just for the handshake; and that a close code is worth reading rather than
 * treating as one thing, because {@link CLOSE_BOARD_LOAD_FAILED} means the board is not there
 * to be edited. Like the states themselves, `onState` is only called when something changes -
 * the caller decides what to say before the first word arrives, which is what the app does with
 * its `connecting`.
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
    // A board this tab could not load stays where it is: what is happening now is the room
    // trying again, and if that fails again the close handler below says so again.
    if (state === 'load_failed') {
      return;
    }
    report(everSynced ? 'reconnecting' : 'connecting');
  });

  // A closed socket carries a code, and the codes mean different things. 4500 is the room
  // saying it could not read the board. Every other code - 1011 when the room's own write
  // failed, 1003 for a message this tab sent that the room could not read, and all the codes
  // that mean nothing arrived at all - is an interruption of a connection this tab had, which
  // is what `reconnecting` is for. Reading the code is what keeps a storage failure from being
  // reported to the user as a missing board.
  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) {
      report('load_failed');
      return;
    }
    if (state === 'load_failed') {
      // The room is still trying to read the board. "Reconnecting…" would imply the board is
      // there and only the way to it is down, which is a different promise than the tab can make.
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
    // simply the board appearing. A board that could not be loaded and has now synced is the
    // same thing: the message goes, the board is whatever it turns out to be, and editing opens
    // without the page being reloaded.
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
