import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

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
  let loadFailed = false;

  const handleWsClose = (event: CloseEvent) => {
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      loadFailed = true;
      onState('load_failed');
    }
  };

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const handleStatus = (event: { status: string }) => {
    const s = event.status;

    if (s === 'connected') {
      // Attach close-code listener for load-failed detection
      if (provider.ws) {
        provider.ws.addEventListener('close', handleWsClose);
      }
      if (loadFailed) return; // stay in load_failed state
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
      if (loadFailed) return; // stay in load_failed state
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
      if (provider.ws) {
        provider.ws.removeEventListener('close', handleWsClose);
      }
      provider.off('status', handleStatus);
      provider.destroy();
    },
  };
}
