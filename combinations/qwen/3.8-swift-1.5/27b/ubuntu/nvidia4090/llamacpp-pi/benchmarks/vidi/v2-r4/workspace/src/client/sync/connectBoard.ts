import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/api/rooms`;

  let hasConnected = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const handleStatus = (event: { status: string }) => {
    const s = event.status;

    if (s === 'connected') {
      if (!hasConnected) {
        // First connection: wait for sync to complete
        if (provider.synced) {
          hasConnected = true;
          onState('connected');
        } else {
          const onSync = (state: boolean) => {
            if (state) {
              hasConnected = true;
              onState('connected');
              provider.off('sync', onSync);
            }
          };
          provider.on('sync', onSync);
        }
      } else {
        // Reconnected after being disconnected
        onState('confirmed');
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          onState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    } else if (s === 'disconnected') {
      if (hasConnected) {
        if (confirmTimer) clearTimeout(confirmTimer);
        onState('reconnecting');
      } else {
        onState('connecting');
      }
    } else {
      // 'connecting'
      onState('connecting');
    }
  };

  provider.on('status', handleStatus);

  return {
    destroy() {
      if (confirmTimer) clearTimeout(confirmTimer);
      provider.off('status', handleStatus);
      provider.destroy();
    },
  };
}
