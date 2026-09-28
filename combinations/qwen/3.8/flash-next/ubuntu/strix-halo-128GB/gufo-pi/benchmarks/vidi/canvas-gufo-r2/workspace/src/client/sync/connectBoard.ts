/**
 * Client connection: creates WebsocketProvider, maps its status to ConnectionState.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

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

  const handleSync = (isSynced: boolean) => {
    if (isSynced) {
      if (!hasBeenConnected) {
        hasBeenConnected = true;
        onState('connected');
      }
    }
  };

  const handleStatus = (event: { status: string }) => {
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

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);

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
      provider.disconnect();
      provider.destroy();
    },
  };
}
