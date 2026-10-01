// src/client/sync/connectBoard.ts
// Creates a y-websocket WebsocketProvider and maps its status to our ConnectionState.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const origin = `${protocol}//${window.location.host}`;

  const provider = new WebsocketProvider(origin, `/api/rooms/${boardId}`, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let currentState: ConnectionState = 'connecting';

  const setState = (s: ConnectionState) => {
    if (currentState === s) return;
    currentState = s;
    onState(s);
  };

  const onStatus = (event: { status: string }) => {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }

    const status = event.status;

    if (status === 'connected') {
      if (provider.synced) {
        if (hasConnected && currentState === 'reconnecting') {
          // Reconnected: show confirmed for CONNECTED_CONFIRMATION_MS
          setState('confirmed');
          confirmTimer = setTimeout(() => {
            confirmTimer = null;
            setState('connected');
          }, CONNECTED_CONFIRMATION_MS);
        } else {
          hasConnected = true;
          setState('connected');
        }
      } else {
        // Connected but not yet synced
        if (!hasConnected) {
          setState('connecting');
        }
      }
    } else if (status === 'disconnected') {
      if (hasConnected) {
        setState('reconnecting');
      } else {
        setState('connecting');
      }
    }
    // 'connecting' status: stay in current state
  };

  const onSync = () => {
    // When sync completes and we're connected, update state
    if (provider.wsconnected && provider.synced) {
      if (hasConnected && currentState === 'reconnecting') {
        setState('confirmed');
        confirmTimer = setTimeout(() => {
          confirmTimer = null;
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        hasConnected = true;
        setState('connected');
      }
    }
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  // Initial state
  onState('connecting');

  return {
    destroy() {
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
