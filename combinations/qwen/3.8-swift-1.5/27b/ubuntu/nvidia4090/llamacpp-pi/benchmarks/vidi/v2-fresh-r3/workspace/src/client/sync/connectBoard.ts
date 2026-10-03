import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * Creates a y-websocket WebsocketProvider for the given board and doc.
 * Maps provider status + sync events to a ConnectionState callback.
 *
 * State mapping:
 * - provider 'connecting' before first sync → 'connecting'
 * - provider 'connected' + sync(true) → 'connected'
 * - 'disconnected' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS then 'connected'
 *
 * Returns a `destroy()` function to clean up the provider.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/api/rooms`;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let isSynced = false;
  let wasReconnecting = false;
  let providerStatus: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const computeState = (): ConnectionState => {
    if (providerStatus === 'disconnected' && hasConnected) {
      return 'reconnecting';
    }
    if (providerStatus === 'connected' && isSynced) {
      if (wasReconnecting) {
        wasReconnecting = false;
        return 'confirmed';
      }
      return 'connected';
    }
    return 'connecting';
  };

  const updateState = () => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }

    const state = computeState();
    onState(state);

    if (state === 'confirmed') {
      confirmTimer = setTimeout(() => {
        onState('connected');
        confirmTimer = null;
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  const onStatus = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    providerStatus = event.status;
    if (event.status === 'connected') {
      if (!hasConnected) {
        hasConnected = true;
      }
    } else if (event.status === 'disconnected' && hasConnected) {
      wasReconnecting = true;
    }
    updateState();
  };

  const onSync = (synced: boolean) => {
    isSynced = synced;
    updateState();
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  // Initial state
  updateState();

  return {
    destroy() {
      if (confirmTimer !== null) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
