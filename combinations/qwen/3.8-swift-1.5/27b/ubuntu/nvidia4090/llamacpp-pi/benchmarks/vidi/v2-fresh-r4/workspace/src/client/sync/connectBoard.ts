import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * Connect a Y.Doc to a board room via y-websocket WebsocketProvider.
 * Maps provider status + sync events to a simplified ConnectionState.
 *
 * Returns a destroy() function that disconnects and cleans up.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  // Determine ws origin from current page
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsOrigin = `${proto}//${window.location.host}`;

  const provider = new WebsocketProvider(wsOrigin, `/api/rooms/${boardId}`, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let currentState: ConnectionState = 'connecting';

  function setState(s: ConnectionState) {
    if (currentState === s) return;
    currentState = s;
    onState(s);
  }

  function handleSync() {
    const connected = provider.wsconnected;
    const synced = provider.synced;

    if (connected && synced) {
      if (hasConnected) {
        // Reconnected after being disconnected
        setState('confirmed');
        if (confirmationTimer) clearTimeout(confirmationTimer);
        confirmationTimer = setTimeout(() => {
          setState('connected');
          confirmationTimer = null;
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        hasConnected = true;
        setState('connected');
      }
    } else {
      if (hasConnected) {
        // Was connected, now lost
        if (confirmationTimer) {
          clearTimeout(confirmationTimer);
          confirmationTimer = null;
        }
        setState('reconnecting');
      } else {
        setState('connecting');
      }
    }
  }

  const statusHandler = () => handleSync();
  const syncHandler = () => handleSync();

  provider.on('status', statusHandler);
  provider.on('sync', syncHandler);

  // Initial state
  setState('connecting');

  return {
    destroy() {
      if (confirmationTimer) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
      }
      provider.off('status', statusHandler);
      provider.off('sync', syncHandler);
      provider.destroy();
    },
  };
}
