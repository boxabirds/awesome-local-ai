import * as Y from 'yjs';
import {
  BOARD_LOAD_TIMEOUT_MS,
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { ROOM_PATH_PREFIX } from '../../shared/protocol';
import { BoardSocket } from './BoardSocket';

/**
 * What the connection is doing, in the order a session meets them: the first load, a
 * live board, an outage, and the moment the board is live again. `load_failed` is the
 * one that is not on that order but beside it: the room said this board could not be
 * loaded (or never got anywhere near saying anything), and until that stops being
 * true nothing else about the wire is worth reporting.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

export interface BoardConnection {
  /** Detach from the document: on unmount, or when this page moves to another board. */
  destroy(): void;
}

/**
 * Whether this connection lets the page edit the board. False only for `load_failed`:
 * a board that could not be loaded is not presented as an editable one (PRD), and a
 * storage failure — which says nothing about the board — must not lock editing either
 * (TC-28), so plain `reconnecting` stays editable exactly as story 3 left it.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The server half of the provider address. The socket address joins it with the room
 * name using a `/`, and the room name is the board id, so this ends up as
 * `<scheme>://<host>/api/rooms/<boardId>` — the address `src/worker/index.ts` routes
 * to that board's room.
 */
export function boardRoomServerUrl(origin: string = window.location.origin): string {
  return `${origin.replace(/^http/, 'ws')}${ROOM_PATH_PREFIX}`.replace(/\/$/, '');
}

/**
 * Put `doc` on the wire for one board and report what the connection is doing.
 *
 * There is no reconnection logic here: the socket retries with exponential backoff
 * (capped at `RECONNECT_MAX_BACKOFF_MS`) and the board stays editable throughout,
 * because edits go into the local document either way. What this function adds is the
 * distinction the badge cares about — before the first sync nobody knows yet whether
 * this is a slow start or a broken address, so it says 'connecting'; after a
 * connection that was actually working has been lost, it says 'reconnecting'; and
 * when that connection is back and synced, it is `confirmed` for
 * `CONNECTED_CONFIRMATION_MS` before going quiet again.
 *
 * Load failure is the truth-telling part (design "The client's side of a failed
 * load"). Two paths lead to it and neither shows a fake board: a room that answers
 * every socket with 4500 says so directly (`onLoadFailed`), and a socket that was
 * never opened at all — a load holding up the upgrade — gets `BOARD_LOAD_TIMEOUT_MS`
 * and then says that instead. Either way the badge says the board failed to load,
 * the app refuses edits, and the retry loop continues underneath: the room retries
 * its load at most once per `LOAD_RETRY_MIN_INTERVAL_MS`, so a transient load failure
 * self-heals within seconds — and only the room's own timer decides when.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  let state: ConnectionState = 'connecting';
  let loadFailed = false;
  let everConnected = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  const publish = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const clearConfirmation = (): void => {
    if (confirmation === null) return;
    clearTimeout(confirmation);
    confirmation = null;
  };
  const clearLoadTimer = (): void => {
    if (loadTimer === null) return;
    clearTimeout(loadTimer);
    loadTimer = null;
  };

  function onStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    if (status === 'connected') {
      everConnected = true;
      clearLoadTimer();
      // Reconnecting after a load failure stays load_failed: a socket that opened is
      // not yet a board that loaded, and only a sync says which of the two happened.
      if (!loadFailed) publish('connected');
      return;
    }
    if (status === 'connecting') {
      if (!everConnected && !loadFailed && loadTimer === null) {
        // Never opened at all: after `BOARD_LOAD_TIMEOUT_MS` this is a load failure,
        // not a slow start. The socket keeps trying in the background either way.
        loadTimer = setTimeout(() => {
          loadTimer = null;
          if (!everConnected && !loadFailed) {
            loadFailed = true;
            publish('load_failed');
          }
        }, BOARD_LOAD_TIMEOUT_MS);
      }
      return;
    }
    // disconnected. A socket that never got anywhere is still the first load, not an outage.
    if (!loadFailed && state !== 'connecting') publish('reconnecting');
  }

  function onSync(synced: boolean): void {
    if (!synced) return;
    // A sync is one truth that beats every badge: the board loaded, whatever the
    // socket did before saying so.
    if (loadFailed) {
      loadFailed = false;
      clearLoadTimer();
      publish('connected');
    }
    if (state === 'connecting') publish('connected');
    if (state === 'reconnecting') {
      publish('confirmed');
      clearConfirmation();
      confirmation = setTimeout(() => publish('connected'), CONNECTED_CONFIRMATION_MS);
    }
  }

  function onLoadFailed(): void {
    // 4500: the room said this board could not be loaded. Not a successful
    // connection, not a board: say it, and let the retry loop wait for the room's
    // own retry clock.
    loadFailed = true;
    clearLoadTimer();
    publish('load_failed');
  }

  // Constructed last on purpose: the socket may report its first `connecting` status
  // synchronously, and every piece of state above has to exist by then.
  const socket = new BoardSocket(boardRoomServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    onStatus,
    onSync,
    onLoadFailed,
  });

  return {
    destroy(): void {
      clearConfirmation();
      clearLoadTimer();
      socket.destroy();
    },
  };
}
