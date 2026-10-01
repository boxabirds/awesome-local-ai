import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface ConnectionHandle {
  destroy(): void;
}

/**
 * Create a WebsocketProvider for a board and map its events to a ConnectionState.
 *
 * State mapping:
 * - provider 'connecting' before first sync → 'connecting'
 * - provider 'connected' + synced(true) → 'connected'
 * - provider 'disconnect' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS → 'connected'
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): ConnectionHandle {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${wsProtocol}//${location.host}/api/rooms`;

  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasBeenConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmationTimer = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const emitState = (state: ConnectionState) => {
    onState(state);
  };

  const handleStatus = (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    if (event.status === 'disconnected') {
      clearConfirmationTimer();
      if (hasBeenConnected) {
        emitState('reconnecting');
      }
      // If never connected, stay in 'connecting' (initial load)
    } else if (event.status === 'connected') {
      // Socket is open but not yet synced; wait for sync event
    } else {
      // 'connecting'
      if (!hasBeenConnected) {
        emitState('connecting');
      }
    }
  };

  const handleSync = (synced: boolean) => {
    if (synced) {
      if (!hasBeenConnected) {
        hasBeenConnected = true;
        emitState('connected');
      } else {
        // Reconnected: show 'confirmed' for CONNECTED_CONFIRMATION_MS
        clearConfirmationTimer();
        emitState('confirmed');
        confirmationTimer = setTimeout(() => {
          confirmationTimer = null;
          emitState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    }
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);

  // If already connected and synced (unlikely on creation but handle edge case)
  if (provider.wsconnected && provider.synced) {
    hasBeenConnected = true;
    emitState('connected');
  } else {
    emitState('connecting');
  }

  return {
    destroy() {
      clearConfirmationTimer();
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.destroy();
    },
  };
}
