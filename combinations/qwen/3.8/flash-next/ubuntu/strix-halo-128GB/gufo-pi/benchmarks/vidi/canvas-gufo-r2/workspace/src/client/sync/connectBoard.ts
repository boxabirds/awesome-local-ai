/**
 * Client connection: creates WebsocketProvider, maps its status to ConnectionState.
 *
 * Close code 4500 (the server could not load this board) maps to 'load_failed':
 * the badge goes red and the UI stops mutating the doc. The provider keeps
 * retrying on its normal backoff schedule (4500 is not in y-websocket's
 * permanent 4400-4499 range), and a later successful sync clears the state.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

export interface BoardConnection {
  destroy(): void;
}

function getWsOrigin(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

/**
 * Connect a Y.Doc to a board via WebSocket, reporting state changes.
 * BroadcastChannel is disabled so tabs in the same browser cannot sync around the server.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const serverUrl = `${getWsOrigin()}/api/rooms`;

  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasBeenConnected = false;
  let confirmedTimer: ReturnType<typeof setTimeout> | null = null;
  // Set when the server closed with 4500; cleared by a successful sync.
  let loadFailed = false;

  const handleSync = (isSynced: boolean) => {
    if (isSynced) {
      if (loadFailed) {
        // The board loaded after a retry: editing is safe again.
        loadFailed = false;
        hasBeenConnected = true;
        onState('connected');
      } else if (!hasBeenConnected) {
        hasBeenConnected = true;
        onState('connected');
      }
    }
  };

  const handleStatus = (event: { status: string }) => {
    // While the board is known-broken the badge stays red: the 'disconnected'
    // status that follows a 4500 close must not downgrade it to amber.
    if (loadFailed) return;
    if (event.status === 'connected') {
      // Socket opened; wait for sync to confirm
      if (!hasBeenConnected) {
        onState('connecting');
      } else if (confirmedTimer !== null || provider.wsconnected) {
        // We were in reconnecting and now reconnected
        if (confirmedTimer) clearTimeout(confirmedTimer);
        onState('confirmed');
        confirmedTimer = setTimeout(() => {
          confirmedTimer = null;
          onState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    } else if (event.status === 'disconnected') {
      if (hasBeenConnected) {
        if (confirmedTimer) {
          clearTimeout(confirmedTimer);
          confirmedTimer = null;
        }
        onState('reconnecting');
      }
    } else if (event.status === 'connecting') {
      if (!hasBeenConnected) {
        onState('connecting');
      }
    }
  };

  // y-websocket emits [event, provider]; event is null for local disconnects.
  // Any other close (network drop, 1011 storage failure reset) is 'reconnecting'.
  const handleConnectionClose = (event: { code?: number } | null) => {
    const code = typeof event?.code === 'number' ? event.code : 0;
    if (code === CLOSE_BOARD_LOAD_FAILED) {
      loadFailed = true;
      if (confirmedTimer) {
        clearTimeout(confirmedTimer);
        confirmedTimer = null;
      }
      onState('load_failed');
      return;
    }
    if (loadFailed) return;
    if (hasBeenConnected) onState('reconnecting');
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);
  provider.on('connection-close', handleConnectionClose);

  // Install test hooks for e2e
  if (typeof window !== 'undefined' && (window as any).__vidi6 !== undefined) {
    (window as any).__vidi6.disconnect = () => {
      provider.disconnect();
    };
    (window as any).__vidi6.reconnect = () => {
      provider.connect();
    };
  }

  // Initial state
  if (provider.wsconnected) {
    onState('connecting');
  } else {
    onState('connecting');
  }

  return {
    destroy() {
      if (confirmedTimer) {
        clearTimeout(confirmedTimer);
        confirmedTimer = null;
      }
      // Remove test hooks
      if (typeof window !== 'undefined' && (window as any).__vidi6) {
        delete (window as any).__vidi6.disconnect;
        delete (window as any).__vidi6.reconnect;
      }
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.off('connection-close', handleConnectionClose);
      provider.disconnect();
      provider.destroy();
    },
  };
}
