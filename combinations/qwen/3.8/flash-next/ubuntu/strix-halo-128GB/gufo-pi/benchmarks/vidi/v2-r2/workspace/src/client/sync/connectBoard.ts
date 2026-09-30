import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  destroy(): void;
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsOrigin = `${protocol}//${location.host}`;
  const url = `${wsOrigin}/api/rooms`;

  let hasBeenConnected = false;
  let isReconnecting = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
    connect: true,
  });

  const clearConfirmationTimer = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const handleStatus = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    if (event.status === 'connected') {
      if (hasBeenConnected) {
        // This is a reconnection - wait for sync to confirm
        // State stays 'reconnecting' until sync completes
      }
      // If first connection, we'll transition on sync
    } else if (event.status === 'disconnected' && hasBeenConnected) {
      clearConfirmationTimer();
      isReconnecting = true;
      onState('reconnecting');
    }
  };

  const handleSync = (synced: boolean) => {
    if (!synced) return;

    if (!hasBeenConnected) {
      // Initial sync completed
      hasBeenConnected = true;
      onState('connected');
    } else if (isReconnecting) {
      // Reconnection sync completed - show "Connected" badge briefly
      isReconnecting = false;
      clearConfirmationTimer();
      onState('confirmed');
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        if (provider.wsconnected) {
          onState('connected');
        }
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);

  return {
    destroy() {
      clearConfirmationTimer();
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.destroy();
    },
  };
}
