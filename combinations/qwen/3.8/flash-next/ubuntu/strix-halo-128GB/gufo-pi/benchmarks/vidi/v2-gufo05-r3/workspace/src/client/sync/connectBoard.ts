/**
 * The browser half of live collaboration: one `WebsocketProvider` per board tab.
 *
 * The provider owns the transport (connect, sync, reconnect with backoff). This
 * module only translates its events into the product's four connection states,
 * which is all the status badge needs.
 */

import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/**
 * `connecting`  first load, not synced yet ("Connecting…")
 * `connected`   in sync, badge hidden
 * `reconnecting` the connection was lost; the board stays editable ("Reconnecting…")
 * `confirmed`   back in sync after an outage; shown briefly ("Connected")
 * `load_failed` the service could not read this board. The connection retries by
 *               itself, so the message says so, but the board is read-only until a
 *               sync succeeds: what is on screen is whatever this page happens to
 *               hold, not the board.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Whether the person using this tab may change the board.
 *
 * Everything else about a `load_failed` board stays usable: panning, zooming and
 * reading what is on screen.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export interface BoardConnection {
  /** Detach the provider (unmount, board change, page teardown). */
  destroy(): void;
}

/** The WebSocket endpoint that carries every board: `wss://host/api/rooms`. */
export function roomServerUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/rooms`;
}

/**
 * Attach `doc` to the room for `boardId` and report connection state changes to
 * `onState`.
 *
 * Cross-tab `BroadcastChannel` sync is switched off on purpose: two tabs of the
 * same browser must go through the server, otherwise tests could pass while the
 * server path is broken.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let state: ConnectionState = 'connecting';
  /** True from the first successful sync on: a lost connection is now a outage. */
  let hasSynced = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    onState(next);
  };

  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const onStatus = ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }): void => {
    if (status === 'disconnected') {
      // A socket we had synced on just died: show the outage immediately, even
      // during the green confirmation.
      clearConfirmation();
      if (hasSynced && state !== 'load_failed') publish('reconnecting');
    }
    // 'connecting' / 'connected' (socket open, not synced yet) are not user
    // visible states: the badge changes when the document actually syncs.
  };

  /**
   * The close code is the only place the service can tell a broken board apart
   * from a busy one. Anything else is an outage: `status` already covers it.
   */
  const onClose = (event: CloseEvent | null): void => {
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) {
      clearConfirmation();
      publish('load_failed');
    }
  };

  const onSync = (synced: boolean): void => {
    if (!synced) return;
    // An outage that ended is a recovery: say "Connected" for a moment, then get
    // out of the way. A board that could not be loaded at any point simply returns
    // to normal: the failure message was the news, the silence after it is enough.
    const recovered =
      hasSynced && state === 'reconnecting';
    hasSynced = true;
    if (recovered) {
      clearConfirmation();
      publish('confirmed');
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        publish('connected');
      }, CONNECTED_CONFIRMATION_MS);
      return;
    }
    if (state !== 'confirmed') publish('connected');
  };

  provider.on('status', onStatus);
  provider.on('connection-close', onClose);
  provider.on('sync', onSync);
  // The provider may already be synced by the time these listeners attach.
  if (provider.synced) onSync(true);

  return {
    destroy() {
      clearConfirmation();
      provider.off('status', onStatus);
      provider.off('connection-close', onClose);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
