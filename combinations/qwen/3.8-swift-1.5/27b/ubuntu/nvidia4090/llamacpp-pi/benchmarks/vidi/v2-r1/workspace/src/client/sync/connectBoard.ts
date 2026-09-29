import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export function connectBoard(doc: Y.Doc, boardId: string, onState: (s: ConnectionState) => void): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  const url = `${protocol}://${host}/api/rooms`;

  let hasConnected = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let currentStatus: string = 'connecting';

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const updateState = () => {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }

    if (currentStatus === 'connected' && provider.synced) {
      if (!hasConnected) {
        hasConnected = true;
        onState('connected');
      } else {
        onState('confirmed');
        confirmTimer = setTimeout(() => {
          onState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    } else if (currentStatus === 'disconnected') {
      if (hasConnected) {
        onState('reconnecting');
      } else {
        onState('connecting');
      }
    } else {
      onState('connecting');
    }
  };

  const onStatusEvent = (event: { status: string }) => {
    currentStatus = event.status;
    updateState();
  };

  const onSyncEvent = (_state: boolean) => {
    updateState();
  };

  provider.on('status', onStatusEvent);
  provider.on('sync', onSyncEvent);

  // Initial state
  onState('connecting');

  return {
    destroy() {
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.off('status', onStatusEvent);
      provider.off('sync', onSyncEvent);
      provider.destroy();
    },
  };
}
