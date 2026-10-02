import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  const url = `${protocol}://${host}/api/rooms`;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let isLoadFailed = false;

  const handleStatus = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }

    // y-websocket 3.x exposes `wsconnected` / `wsconnecting` / `synced`
    // (the 2.x `status` / `sync` properties are gone).
    const p = provider as unknown as {
      wsconnected: boolean;
      wsconnecting: boolean;
      synced: boolean;
    };

    if (p.wsconnected && p.synced) {
      if (isLoadFailed) {
        // Recovery from load_failed
        isLoadFailed = false;
        onState('connected');
        return;
      }
      if (hasConnected) {
        onState('confirmed');
        confirmationTimer = setTimeout(() => {
          onState('connected');
          confirmationTimer = null;
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        hasConnected = true;
        onState('connected');
      }
    } else if (!p.wsconnected && hasConnected) {
      if (!isLoadFailed) {
        onState('reconnecting');
      }
    } else if (p.wsconnected && !p.synced) {
      if (!hasConnected && !isLoadFailed) {
        onState('connecting');
      }
    } else if (p.wsconnecting) {
      if (!hasConnected && !isLoadFailed) {
        onState('connecting');
      } else if (!isLoadFailed) {
        onState('reconnecting');
      }
    }
  };

  const handleClose = (event: CloseEvent | null) => {
    if (event && event.code === CLOSE_BOARD_LOAD_FAILED) {
      isLoadFailed = true;
      onState('load_failed');
    }
    // CLOSE_STORAGE_FAILURE (1011) and other codes map to 'reconnecting'
    // which is handled by the status handler
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleStatus);
  provider.on('connection-close', handleClose);

  // Initial state
  onState('connecting');

  return {
    destroy() {
      if (confirmationTimer !== null) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
      }
      provider.off('status', handleStatus);
      provider.off('sync', handleStatus);
      provider.off('connection-close', handleClose);
      provider.destroy();
    },
  };
}
