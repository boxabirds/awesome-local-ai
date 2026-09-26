import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { recordingWebSocket } from '../canvas/testHooks';

/**
 * The connection a board page keeps to its room (contract `sync.client`).
 *
 * The provider is `y-websocket`'s `WebsocketProvider` — the exact client the
 * BoardRoom speaks — pointed at `/api/rooms/<boardId>`. Cross-tab
 * BroadcastChannel sync is switched off so two tabs of the same browser cannot
 * sync around the server: every participant really goes through the room.
 */

/**
 * `connecting`  first connection, never synced yet
 * `connected`   in sync with the room (badge hidden)
 * `reconnecting` connection lost after a successful sync (badge, amber)
 * `confirmed`   just re-synced after an outage (badge, green, for
 *               `CONNECTED_CONFIRMATION_MS`, then `connected`)
 * `load_failed` the room refused this board because it could not load it (badge,
 *               red); the only state in which the board is not editable
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

export interface ConnectBoardResult {
  destroy(): void;
}

export interface ConnectBoardOptions {
  /** Override the room URL (tests). */
  serverUrl?: string;
}

/** Room collection URL: same origin, WebSocket scheme. */
export function roomsUrl(search = ''): string {
  const location = globalThis.window?.location;
  if (location === undefined) return `ws://localhost/api/rooms${search}`;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/rooms${search}`;
}

/**
 * Connect `doc` to the room for `boardId` and report every connection state
 * change through `onState`. The board stays fully editable in every state:
 * edits made while disconnected are in the doc already and are sent as soon as
 * the socket is back (PRD: "keep the board fully editable").
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): ConnectBoardResult {
  const recorder = recordingWebSocket(); // defined only in test builds
  const provider = new WebsocketProvider(
    options.serverUrl ?? roomsUrl(),
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
      ...(recorder ? { WebSocketPolyfill: recorder } : {}),
    },
  );

  /** True once the doc has been in sync with a room at least once. */
  let hasSynced = false;
  /**
   * Set when the room refused the board (close code 4500) and kept until a sync
   * succeeds. The provider retries on its own — 4500 is outside the range
   * `y-websocket` treats as terminal — and a failed retry closing for another
   * reason must not turn "this board couldn't be loaded" into "reconnecting",
   * which would unlock a board whose contents nobody can see.
   */
  let loadFailed = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmation = (): void => {
    if (confirmation !== null) {
      clearTimeout(confirmation);
      confirmation = null;
    }
  };

  /** A re-sync (or reopened socket) starts the green confirmation window. */
  const confirm = (): void => {
    if (confirmation !== null) return; // already inside the confirmation window
    clearConfirmation();
    onState('confirmed');
    confirmation = setTimeout(() => {
      confirmation = null;
      onState('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  /**
   * The room closed our socket. 4500 is the one code that means something about
   * the board rather than the connection: it could not be loaded. Everything
   * else — including 1011, the room's own storage failure — is a dropped
   * connection, where the board is readable and local changes go out again on
   * reconnect (persist.save_failure).
   */
  const handleConnectionClose = (event: { code: number } | null): void => {
    if (event === null || event.code !== CLOSE_BOARD_LOAD_FAILED) return;
    loadFailed = true;
    clearConfirmation();
    onState('load_failed');
  };

  const handleStatus = (event: { status: 'connected' | 'disconnected' | 'connecting' }): void => {
    if (event.status === 'disconnected') {
      if (loadFailed) return; // already showing the load failure; retries change nothing
      // A drop after we were in sync is a reconnection; before the first sync
      // it is still the initial "Connecting…".
      clearConfirmation();
      onState(hasSynced ? 'reconnecting' : 'connecting');
      return;
    }
    if (event.status === 'connected' && hasSynced) {
      confirm();
    }
    // `connecting`, or a socket that is open but not yet synced: leave the
    // current state alone (the sync event below settles it).
  };

  const handleSync = (synced: boolean): void => {
    if (!synced) return;
    // A board that had refused us is now readable: editing comes back on its
    // own, without anyone reloading the page (persist.load_failure).
    loadFailed = false;
    if (!hasSynced) {
      hasSynced = true;
      clearConfirmation();
      onState('connected');
      return;
    }
    confirm();
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);
  provider.on('connection-close', handleConnectionClose);

  return {
    destroy() {
      clearConfirmation();
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.off('connection-close', handleConnectionClose);
      provider.disconnect();
      provider.destroy();
    },
  };
}
