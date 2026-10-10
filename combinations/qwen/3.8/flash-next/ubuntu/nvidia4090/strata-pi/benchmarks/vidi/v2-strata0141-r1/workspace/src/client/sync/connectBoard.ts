/**
 * The browser side of live collaboration (anchor `sync.client`).
 *
 * `connectBoard` owns one `WebsocketProvider` for one board and turns the
 * provider's events into a single, small `ConnectionState` the UI can render:
 *
 *   connecting   the room has not answered this client's first request yet
 *   connected    the room has answered and the link is up (nothing to show)
 *   reconnecting the link that once worked is down, and the board keeps working
 *   confirmed    a lost link came back: a short "Connected" confirmation
 *   load_failed  the room said it could not load this board: retrying, and the
 *                board cannot be edited
 *
 * Design decisions this encodes:
 *
 * - "Connecting…" ends only when the room has actually replied (`sync` true),
 *   not merely when a socket opened, so the board never claims a connection it
 *   does not have.
 * - Cross-tab BroadcastChannel sync is disabled: without it, two tabs in one
 *   browser would share a board without the server, hiding a broken server path.
 * - An empty local awareness state is published so the protocol keeps renewing
 *   it (roughly every 15 s). Without that traffic an idle connection looks dead
 *   to the provider's 30 s watchdog and would be dropped (`live.stability`).
 *   Story 6 puts real presence in the same state.
 * - The local Y.Doc is never blocked: edits made while `reconnecting` stay local
 *   and are sent by the provider as soon as the link is back.
 * - A close with `CLOSE_BOARD_LOAD_FAILED` (4500) is the room saying the board
 *   itself could not be read. That is not a link problem: the state becomes
 *   `load_failed`, which the UI shows honestly and refuses to edit. Every other
 *   close code (1011 after a storage failure, 1003 after a bad frame, 1006 when
 *   a socket died) stays `reconnecting`, because the board is still there and
 *   still editable. 4500 is outside `y-websocket`'s "do not reconnect" range, so
 *   retries continue by themselves and no page reload is needed.
 */

import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS, ROOM_ROUTE_PREFIX } from '../../shared/config';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** The provider events `connectBoard` uses; a test can supply a fake. */
export interface BoardProvider {
  on(name: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(name: 'sync', handler: (synced: boolean) => void): void;
  /** `null` when the close was ours (a disconnect or the watchdog). */
  on(name: 'connection-close', handler: (event: { code: number } | null) => void): void;
  destroy(): void;
}

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

export interface BoardConnection {
  /** Current state (the same value the last listener was given). */
  state(): ConnectionState;
  destroy(): void;
}

export interface ConnectBoardOptions {
  /** Server URL override; the board id is still appended as the room name. */
  url?: string;
  /** Build the provider; defaults to `y-websocket`'s `WebsocketProvider`. */
  provider?: (url: string, boardId: string, doc: Y.Doc) => BoardProvider;
  /** Notified on every state change. */
  onState: (state: ConnectionState) => void;
}

/**
 * The room address for a board.
 *
 * `WebsocketProvider` joins its server URL and the room name with a single
 * '/', so the server URL is the route *without* the board id and the board id
 * is the room name. This looks harmless until two people end up in different
 * rooms, so it is spelled out here and asserted in a unit test.
 */
export const ROOM_WS_ROUTE = ROOM_ROUTE_PREFIX.replace(/\/+$/, '');

/** `wss://host/api/rooms` - the y-websocket server URL for this deployment. */
export function roomServerUrl(origin?: string): string {
  const base =
    origin ??
    (typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin);
  const url = new URL(ROOM_WS_ROUTE, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/+$/, '');
}

/** `wss://host/api/rooms/<boardId>` - the full room address a browser opens. */
export function roomUrl(boardId: string, origin?: string): string {
  return `${roomServerUrl(origin)}/${boardId}`;
}

const defaultProvider = (url: string, boardId: string, doc: Y.Doc): BoardProvider => {
  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  // An empty (but non-null) local state is what makes the protocol renew it.
  provider.awareness.setLocalState({});
  return provider as unknown as BoardProvider;
};

/**
 * Connect `doc` to `boardId`'s room and report the connection state.
 *
 * The returned connection must be destroyed when the board is left; that closes
 * the socket and stops reconnection attempts.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  options: ConnectBoardOptions,
): BoardConnection {
  const { onState } = options;
  const serverUrl = options.url ?? roomServerUrl();
  const provider = (options.provider ?? defaultProvider)(serverUrl, boardId, doc);

  let state: ConnectionState = 'connecting';
  /** True once the room has answered at least once: "connecting" is over. */
  let answered = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const setState = (next: ConnectionState): void => {
    if (next === state) {
      return;
    }
    if (next !== 'confirmed') {
      clearConfirmation();
    }
    state = next;
    onState(next);
  };

  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && answered) {
      // A link that worked is gone. The board stays editable; the provider is
      // already retrying with exponential backoff.
      setState('reconnecting');
    }
    // 'connecting', and a socket that is open but not answered yet, are both
    // still "Connecting…": the room has not confirmed anything.
  });

  provider.on('connection-close', (event) => {
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) {
      // The room refused the board, not the connection. Everything else -
      // 1011 after a storage failure, 1003 after a bad frame, a socket that
      // died - is a link problem and leaves the board editable.
      setState('load_failed');
      return;
    }
    if (answered) {
      setState('reconnecting');
    }
  });

  provider.on('sync', (synced) => {
    if (!synced) {
      if (answered) {
        setState('reconnecting');
      }
      return;
    }
    const wasAway = state === 'reconnecting' || state === 'load_failed';
    answered = true;
    if (wasAway) {
      // The gap was bridged: confirm it, then hide the badge.
      state = 'confirmed';
      onState('confirmed');
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        state = 'connected';
        onState('connected');
      }, CONNECTED_CONFIRMATION_MS);
    } else {
      setState('connected');
    }
  });

  return {
    state: () => state,
    destroy: () => {
      clearConfirmation();
      provider.destroy();
    },
  };
}
