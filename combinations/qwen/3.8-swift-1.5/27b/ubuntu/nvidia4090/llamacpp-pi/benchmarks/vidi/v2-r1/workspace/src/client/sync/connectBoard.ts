import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '@shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/**
 * Returns true if editing is allowed in the given connection state.
 * Editing is disabled only during load_failed.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function connectBoard(doc: Y.Doc, boardId: string, onState: (s: ConnectionState) => void): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  const url = `${protocol}://${host}/api/rooms`;

  let hasConnected = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let currentStatus: string = 'connecting';
  let isLoadFailed = false;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const updateState = () => {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }

    // If we're in load_failed state and we get a successful sync, recover
    if (isLoadFailed && provider.synced && currentStatus === 'connected') {
      isLoadFailed = false;
      hasConnected = true;
      onState('connected');
      return;
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
      if (!isLoadFailed) {
        onState('connecting');
      }
    }
  };

  const onStatusEvent = (event: { status: string }) => {
    currentStatus = event.status;
    updateState();
  };

  const onSyncEvent = (_state: boolean) => {
    updateState();
  };

  // Listen for WebSocket close events to detect load failures
  const onWsClose = (event: CloseEvent) => {
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      isLoadFailed = true;
      onState('load_failed');
    } else if (event.code === CLOSE_STORAGE_FAILURE) {
      // Storage failure: board is readable, unsaved changes will be re-sent on reconnect
      isLoadFailed = false;
      if (hasConnected) {
        onState('reconnecting');
      }
    }
    // Other close codes: the provider will reconnect, status event will handle state
  };

  // Attach close handler to the underlying WebSocket
  const attachCloseHandler = () => {
    const ws = (provider as any).ws as WebSocket | null;
    if (ws) {
      ws.addEventListener('close', onWsClose);
      return;
    }
    // WebSocket not yet created, retry shortly
    setTimeout(attachCloseHandler, 50);
  };
  attachCloseHandler();

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
      const ws = (provider as any).ws as WebSocket | null;
      if (ws) {
        ws.removeEventListener('close', onWsClose);
      }
      provider.destroy();
    },
  };
}
