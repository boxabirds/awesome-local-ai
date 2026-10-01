// The connection: one y-websocket provider per board, pointed at that board's
// room (design: `sync.connection`).
//
// There is one connection per browser tab: `disableBc` is on by default, so the
// tab that holds it sends its own updates and the others get them from the room.
// (Two tabs of one board in one browser is what the end-to-end tests do with
// separate contexts; the BroadcastChannel shortcut would make them agree with
// each other without the room, which is not the thing being tested.)
//
// The room sends the first sync message when a socket is accepted, and
// WebsocketProvider answers it, so the join handshake completes without anything
// extra here: whoever joins first gives the room an empty board, whoever joins
// second is given the board.
//
// Reconnection is the provider's, with the story's backoff ceiling: 500ms, 1s,
// 2s, 4s, 8s, 16s, 30s, staying at 30s. When a link comes back the provider
// resyncs the document, which is how a board missed while nobody was connected
// arrives. `maxConsecutiveFailures` is left unset: a board that is unreachable
// is retried for as long as the tab is open, never given up on.
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { ROOM_PATH_PREFIX } from '../../shared/routes';
import { emulateOutage } from './emulateOutage';

/**
 * Where the board rooms are reachable: the configured origin when there is one
 * (`VITE_BOARD_WS_URL`, e.g. `wss://board.example.com`), and the page's own
 * origin when there is not — which is the normal case, and what a preview
 * deployment needs no setting for.
 */
const SYNC_SERVER_URL: string = import.meta.env.VITE_BOARD_WS_URL ?? '';

/** Where the connection is, in the states the badge can show. `load_failed` is
 * not "no link": it is the room answering and saying it could not read this
 * board, which is why it is its own state and not folded into `reconnecting`.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/**
 * The socket URL for a board: the configured origin when there is one, the
 * page's own origin when there is not, and always the same board id unchanged
 * at the end of it — the id is what the room is addressed by, and what keeps one
 * board's notes from ever being another board's.
 */
export function boardSocketUrl(boardId: string): string {
  return `${roomServer()}/${boardId}`;
}

/**
 * The provider's server address: the origin, with the room route as its path.
 * The provider appends `/<roomname>` to this, so the room name is what lands at
 * the end of `/api/rooms/` and reaches that board's room.
 */
function roomServer(): string {
  const route = ROOM_PATH_PREFIX.replace(/\/+$/, '');
  const configured = SYNC_SERVER_URL.replace(/\/+$/, '');
  if (configured !== '') return `${configured}${route}`;
  const page = globalThis.location;
  const scheme = page?.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${page?.host ?? 'localhost'}${route}`;
}

/** The name of this connection in the room's presence state. */
export const CONNECTION_AWARENESS = 'connection';

export interface BoardConnection {
  /** Stop this connection and unsubscribe from the document. */
  destroy(): void;
  /** The provider, for tests and for nothing else. */
  provider: WebsocketProvider;
  /**
   * Lose the link to the room for `ms` milliseconds, and come back on its own
   * afterwards. Nothing in the app calls this: it exists because a browser's
   * idea of "offline" leaves an open socket open, so an end-to-end test of what
   * a person does during an outage has to drop the link at the socket. See
   * ./emulateOutage.ts.
   */
  emulateOutage(ms: number): void;
}

/**
 * Connect a board document to its room, and report how the connection is doing
 * to `onState` as it changes.
 *
 * The states are what the badge needs and no more: `connecting` until the
 * socket is open, `connected` when it opens (the badge hides then, because
 * people are not told every time a socket opens), `confirmed` once the room has
 * agreed the document, and `reconnecting` from then on whenever the link drops.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: { disableBc?: boolean } = {},
): BoardConnection {
  const provider = new WebsocketProvider(roomServer(), boardId, doc, {
    // Always on: with the BroadcastChannel shortcut a second tab of one board
    // would agree with the first without the room ever being involved, which is
    // the half of this story that has to be true.
    disableBc: options.disableBc ?? true,
    // The story's backoff ceiling.
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    params: {},
  });

  let state: ConnectionState = 'connecting';
  // The room has agreed this document at least once. Until then there is
  // nothing to announce, and a lost link is still "Connecting…".
  let agreed = false;
  // And the link has been lost since it was agreed: that is what makes the next
  // one a way back rather than a first load.
  let dropped = false;
  let linkUp = false;
  let stopped = false;
  // The room closed us because it could not read this board (CLOSE_BOARD_LOAD_#
  // FAILED). Until a sync proves otherwise, that is what the badge says, and
  // editing is stopped; the provider keeps retrying underneath regardless.
  let loadFailed = false;
  const emit = (next: ConnectionState): void => {
    if (stopped || next === state) return;
    state = next;
    onState(next);
  };

  // This connection's entry in the room's presence state. It carries no board
  // data and nothing depends on it; it is what the awareness message the room
  // relays is about.
  provider.awareness.setLocalStateField(CONNECTION_AWARENESS, { boardId });

  const onStatus = (event: { status: 'connecting' | 'connected' | 'disconnected' }): void => {
    linkUp = event.status === 'connected';
    if (event.status === 'disconnected') {
      if (loadFailed) {
        // A board that cannot be read is retried in the background, but the tab
        // keeps saying so rather than the "Reconnecting…" that promises a board.
        emit('load_failed');
        return;
      }
      if (agreed) dropped = true;
      // Before the document has ever been agreed this is still the first
      // attempt; after that it is an outage, which is what "Reconnecting…" is.
      emit(agreed ? 'reconnecting' : 'connecting');
      return;
    }
    if (loadFailed) {
      // Open again, but not yet read: still no board to call connected over.
      emit('load_failed');
      return;
    }
    if (event.status === 'connected' && agreed) {
      // A board that was already agreed does not need announcing again; one
      // that came back from an outage does, once.
      emit(dropped ? 'confirmed' : 'connected');
      dropped = false;
    }
  };

  // The close event carries the code, and it is the only place that does: the
  // `status` event says only "disconnected". `connection-close` fires while the
  // socket is still the provider's, so its code is readable here and nowhere else.
  const onClose = (event: unknown): void => {
    const code = (event as { code?: number } | null)?.code;
    loadFailed = code === CLOSE_BOARD_LOAD_FAILED;
    if (loadFailed) emit('load_failed');
  };

  // The document is agreed with the room when the room has answered this
  // document's sync step two. Until then nobody is told they are connected: a
  // socket that opens onto an empty board is not yet a board.
  const onSync = (synced: boolean): void => {
    if (!synced) return;
    // The room read the board and agreed it: whatever it said before is no longer
    // true, so the load-failure message comes down and editing is allowed again.
    loadFailed = false;
    agreed = true;
    if (!linkUp) return;
    if (dropped) {
      dropped = false;
      emit('confirmed');
    } else if (state !== 'confirmed') {
      // The room has this document. A connection that has already said so has
      // nothing to say again: being told the board is agreed is said once per
      // return, not once per sync message.
      emit('connected');
    }
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('connection-close', onClose as (...args: unknown[]) => void);

  return {
    provider,
    emulateOutage(ms: number): void {
      emulateOutage(provider, ms);
    },
    destroy(): void {
      stopped = true;
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('connection-close', onClose as (...args: unknown[]) => void);
      provider.awareness.setLocalStateField(CONNECTION_AWARENESS, null);
      provider.destroy();
    },
  };
}
