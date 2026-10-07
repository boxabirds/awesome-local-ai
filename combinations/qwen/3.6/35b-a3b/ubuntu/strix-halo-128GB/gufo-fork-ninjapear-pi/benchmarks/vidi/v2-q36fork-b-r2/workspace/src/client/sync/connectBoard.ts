import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { ObservableV2 } from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed';

const WS_URL = ((): string => {
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (loc) {
    return `${loc.protocol}//${loc.host}/api/rooms`;
  }
  return '';
})();

/**
 * Connect a Y.Doc to a board via WebSocket.
 * Returns an object with destroy() that should be called on unmount or board change.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): { destroy: () => void } {
  // Track state externally since we can't rely on provider.status getter
  let currentState: ConnectionState = 'connecting';
  let wasEverConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmationTimer = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const notify = (state: ConnectionState) => {
    currentState = state;
    onState(state);
  };

  const provider = new WebsocketProvider(WS_URL, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true, // Don't sync via BroadcastChannel — tests would pass without server
    connect: false,  // We'll control when to connect for better state management
  });

  // First sync completes → connected
  const onSync = (isSynced: boolean) => {
    if (isSynced) {
      // Check what our current tracking says
      if (!wasEverConnected) {
        // First ever connection
        notify('connected');
        wasEverConnected = true;
      } else if (currentState === 'reconnecting') {
        // Re-connected after outage
        notify('confirmed');
        clearConfirmationTimer();
        confirmationTimer = setTimeout(() => {
          notify('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    }
  };
  provider.on('sync', onSync);

  // Connection-status events
  const onStatus = (event: { status: string }) => {
    switch (event.status) {
      case 'connected':
        // Already handled in onSync, but ensure we're not stuck in connecting
        break;
      case 'disconnected':
        clearConfirmationTimer();
        notify('reconnecting');
        break;
      case 'connecting':
        notify('reconnecting');
        break;
    }
  };
  provider.on('status', onStatus);

  // Also handle connection-close (when server closes permanently)
  const onClose = () => {
    clearConfirmationTimer();
    notify('reconnecting');
  };
  provider.on('connection-close', onClose);

  // connection-error
  const onError = () => {
    clearConfirmationTimer();
    notify('reconnecting');
  };
  provider.on('connection-error', onError);

  // Start the connection
  provider.connect();

  return {
    destroy: () => {
      clearConfirmationTimer();
      provider.off('sync', onSync);
      provider.off('status', onStatus);
      provider.off('connection-close', onClose);
      provider.off('connection-error', onError);
      provider.destroy();
    },
  };
}
