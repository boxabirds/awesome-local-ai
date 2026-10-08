/** Client-side WebSocket connection to BoardRoom for story 3 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  RECONNECT_MAX_BACKOFF_MS,
  CONNECTED_CONFIRMATION_MS,
} from '@shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

let globalState: ConnectionState = 'connecting';

export function getState(): ConnectionState {
  return globalState;
}

/**
 * Connect a Y.Doc to a board via WebSocket.
 * Returns a destroy function to clean up on unmount or board change.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const wsOrigin = typeof document !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    : '';

  const provider = new WebsocketProvider(
    wsOrigin,
    `api/rooms/${boardId}`,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true, // Disable BroadcastChannel so tabs don't sync around the server
    },
  );

  // Track whether we've ever been synced (to distinguish first-connect vs reconnect)
  let hasSynced = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  // Mapping of provider status events to our connection state
  provider.on('status', (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    if (confirmationTimer) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }

    if (event.status === 'disconnected') {
      if (hasSynced) {
        globalState = 'reconnecting';
        onState('reconnecting');
      }
    } else if (event.status === 'connected') {
      if (!hasSynced) {
        // First time connecting — provider says connected but sync not yet confirmed
        // We'll wait for the 'sync' event
      } else {
        // Re-connected → show "Confirmed" briefly
        globalState = 'confirmed';
        onState('confirmed');
        confirmationTimer = setTimeout(() => {
          globalState = 'connected';
          confirmationTimer = null;
          onState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    }
    // 'connecting' means socket is opening; no badge needed
  });

  provider.on('sync', (isSynced: boolean) => {
    if (isSynced && !hasSynced) {
      hasSynced = true;
      globalState = 'connected';
      onState('connected');
    }
  });

  // Expose state globally for e2e tests
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    (window as any).__vidi6 = (window as any).__vidi6 || {};
    (window as any).__vidi6.connectionState = globalState;
    const origOnState = onState;
    onState = (s: ConnectionState) => {
      (window as any).__vidi6.connectionState = s;
      origOnState(s);
    };
  }

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
