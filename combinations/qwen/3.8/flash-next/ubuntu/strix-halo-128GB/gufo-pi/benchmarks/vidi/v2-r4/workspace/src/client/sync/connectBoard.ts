import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  destroy(): void;
}

/**
 * Connects a Y.Doc to the BoardRoom server via y-websocket.
 *
 * State mapping:
 * - provider `connecting` before first sync → 'connecting'
 * - provider `connected` + `sync(true)` → 'connected' (first time) or 'confirmed' (after reconnect)
 * - provider `disconnected` after having connected → 'reconnecting'
 * - 'confirmed' → 'connected' after CONNECTED_CONFIRMATION_MS
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  // Determine WebSocket origin from the page's location
  const protocol = typeof window !== 'undefined'
    ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:')
    : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:8787';
  const url = `${protocol}//${host}/api/rooms`;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let currentState: ConnectionState = 'connecting';

  function setState(state: ConnectionState) {
    if (state === currentState) return;
    currentState = state;
    onState(state);
  }

  function clearConfirmation() {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  }

  const onStatus = (event: { status: string }) => {
    if (event.status === 'disconnected') {
      clearConfirmation();
      if (hasConnected) {
        setState('reconnecting');
      }
    }
  };

  const onSync = (synced: boolean) => {
    if (synced) {
      clearConfirmation();
      if (!hasConnected) {
        hasConnected = true;
        setState('connected');
      } else {
        // Reconnected: show confirmed for CONNECTED_CONFIRMATION_MS then hide
        setState('confirmed');
        confirmationTimer = setTimeout(() => {
          confirmationTimer = null;
          if (currentState === 'confirmed') {
            setState('connected');
          }
        }, CONNECTED_CONFIRMATION_MS);
      }
    }
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  // If already synced immediately
  if (provider.wsconnected && provider.synced) {
    hasConnected = true;
    setState('connected');
  }

  return {
    destroy() {
      clearConfirmation();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
