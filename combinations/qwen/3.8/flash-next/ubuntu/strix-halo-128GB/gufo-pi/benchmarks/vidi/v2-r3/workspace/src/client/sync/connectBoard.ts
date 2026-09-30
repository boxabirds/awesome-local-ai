import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface ConnectionHandle {
  destroy(): void;
}

/**
 * Creates a WebsocketProvider for the given Y.Doc and boardId, maps its
 * status/sync events to our ConnectionState machine, and calls onState on
 * every transition.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): ConnectionHandle {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${wsProtocol}//${window.location.host}/api/rooms`;

  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let currentState: ConnectionState = 'connecting';
  let hasBeenSynced = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: ConnectionState) {
    if (next === currentState) return;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    currentState = next;
    onState(next);
  }

  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connecting') {
      if (hasBeenSynced) {
        // Reconnecting after a previous successful connection
        setState('reconnecting');
      } else {
        setState('connecting');
      }
    } else if (event.status === 'connected') {
      // The socket is open but we may not be synced yet
      if (hasBeenSynced) {
        // Show "Connected" confirmation after reconnect
        setState('confirmed');
        confirmTimer = setTimeout(() => {
          confirmTimer = null;
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
      // else: wait for sync event before marking connected
    } else if (event.status === 'disconnected') {
      if (hasBeenSynced) {
        setState('reconnecting');
      }
    }
  });

  provider.on('sync', (synced: boolean) => {
    if (synced) {
      hasBeenSynced = true;
      if (currentState === 'connecting' || currentState === 'reconnecting') {
        // First sync → connected (no "connected" flash on first connect)
        setState('connected');
      } else if (currentState === 'confirmed') {
        // Already showing confirmation — let the timer handle transition
      }
    }
  });

  // Handle the case where we are already connected and synced at mount time
  // (provider might connect before we register listeners)
  setTimeout(() => {
    if (provider.wsconnected && provider.synced && !hasBeenSynced) {
      hasBeenSynced = true;
      setState('connected');
    }
  }, 0);

  return {
    destroy() {
      if (confirmTimer) clearTimeout(confirmTimer);
      provider.destroy();
    },
  };
}
