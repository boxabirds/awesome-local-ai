// connectBoard (story 3): creates a y-websocket WebsocketProvider for the
// board and maps its status/sync events to our ConnectionState.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

interface ConnectBoardResult {
  destroy(): void;
}

/**
 * Connect a Y.Doc to a board room via the y-websocket provider.
 *
 * State mapping:
 * - provider 'connecting' (never connected) → 'connecting'
 * - provider 'connected' + sync(true) → 'connected' (first time)
 * - provider 'disconnected' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS → 'connected'
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): ConnectBoardResult {
  const wsOrigin = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.host;

  const provider = new WebsocketProvider(
    `${wsOrigin}//${wsHost}/api/rooms`,
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
    },
  );

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let currentState: ConnectionState = 'connecting';

  function setState(s: ConnectionState) {
    if (currentState === s) return;
    currentState = s;
    onState(s);
  }

  function showConfirmed() {
    setState('confirmed');
    if (confirmationTimer) clearTimeout(confirmationTimer);
    confirmationTimer = setTimeout(() => {
      confirmationTimer = null;
      setState('connected');
    }, CONNECTED_CONFIRMATION_MS);
  }

  function handleStatus(event: { status: string }) {
    if (event.status === 'connected') {
      // Socket is open; sync state will be confirmed via the 'sync' event
    } else if (event.status === 'disconnected' || event.status === 'connecting') {
      if (hasConnected) {
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

  function handleSync(isSynced: boolean) {
    if (isSynced && provider.wsconnected) {
      if (hasConnected && currentState === 'reconnecting') {
        // Reconnected: show 'confirmed' then transition to 'connected'
        showConfirmed();
      } else {
        hasConnected = true;
        setState('connected');
      }
    }
  }

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);

  return {
    destroy() {
      if (confirmationTimer) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
      }
      provider.destroy();
    },
  };
}
