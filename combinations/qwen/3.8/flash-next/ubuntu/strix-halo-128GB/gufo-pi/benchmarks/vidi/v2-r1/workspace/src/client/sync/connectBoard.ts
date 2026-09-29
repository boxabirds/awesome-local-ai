import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { TEST_MODE } from '../canvas/testHooks';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  destroy(): void;
}

/**
 * Connects a Y.Doc to the board room via y-websocket provider.
 * Maps provider status and sync events to our ConnectionState:
 * - connecting: initial state before first sync
 * - connected: synced successfully
 * - reconnecting: disconnected after having been connected
 * - confirmed: reconnected after a disconnect (shown for CONNECTED_CONFIRMATION_MS)
 *
 * BroadcastChannel is disabled so tabs cannot sync around the server.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  // Determine the WebSocket URL from the page origin
  const protocol = typeof window !== 'undefined'
    ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:')
    : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
  const serverUrl = `${protocol}//${host}/api/rooms`;

  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(state: ConnectionState): void {
    onState(state);
    // Expose connection state for test hooks
    if (TEST_MODE && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__vidi6_connectionState = state;
    }
  }

  function clearConfirmationTimer(): void {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  }

  // Provider status events
  const statusHandler = (event: { status: string }) => {
    if (event.status === 'connected') {
      // Don't immediately transition to connected - wait for sync
    } else if (event.status === 'disconnected') {
      if (hasConnected) {
        clearConfirmationTimer();
        setState('reconnecting');
      }
    } else if (event.status === 'connecting') {
      if (hasConnected) {
        // Reconnecting - stay in reconnecting state
      }
    }
  };

  // Provider sync events
  const syncHandler = (synced: boolean) => {
    if (synced) {
      clearConfirmationTimer();
      if (hasConnected) {
        // This is a reconnection - show confirmed state briefly
        setState('confirmed');
        confirmationTimer = setTimeout(() => {
          confirmationTimer = null;
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        // First connection
        hasConnected = true;
        setState('connected');
      }
    }
  };

  provider.on('status', statusHandler);
  provider.on('sync', syncHandler);

  // Initial state
  setState('connecting');

  return {
    destroy() {
      clearConfirmationTimer();
      provider.off('status', statusHandler);
      provider.off('sync', syncHandler);
      provider.destroy();
    },
  };
}
