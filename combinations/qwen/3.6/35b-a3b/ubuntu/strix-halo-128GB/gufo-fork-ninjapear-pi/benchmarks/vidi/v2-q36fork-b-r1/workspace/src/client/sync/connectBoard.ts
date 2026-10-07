/**
 * Client-side connection helper.
 * Story 3 — live collaboration.
 *
 * Creates a y-websocket WebsocketProvider connecting to the BoardRoom
 * and maps provider status events to ConnectionState values used by
 * the ConnectionStatus badge component.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { WebsocketProvider as WSPType } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@/shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * Connect a Y.Doc to a board via WebSocket.
 * Returns a destroy function to clean up the provider on unmount/board change.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): { destroy(): void } {
  const wsOrigin = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : 'ws://localhost:8787';

  const provider: WSPType = new WebsocketProvider(
    wsOrigin + '/api/rooms',
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true, // No BroadcastChannel so same-browser tabs must go through the server
    },
  );

  // Track state machine
  let currentState: ConnectionState = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(state: ConnectionState): void {
    if (state === currentState) return;
    currentState = state;
    // Clear any pending confirmation timer when transitioning away from confirmed
    if (state !== 'confirmed' && confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    onState(state);
  }

  // --- Provider event wiring ---
  provider.on('status', (event: { status: string }) => {
    switch (event.status) {
      case 'connecting':
        setState('connecting');
        break;
      case 'connected':
        // First sync completed → connected
        if (currentState === 'connecting') {
          setState('connected');
        } else if (currentState === 'reconnecting') {
          // Reconnected after outage → show "Connected" briefly
          setState('confirmed');
          confirmTimer = setTimeout(() => {
            setState('connected');
            confirmTimer = null;
          }, CONNECTED_CONFIRMATION_MS);
        }
        break;
      case 'disconnected':
        // Was connected but socket closed → reconnecting
        if (currentState === 'connected' || currentState === 'confirmed') {
          setState('reconnecting');
        }
        break;
    }
  });

  // "sync" event fires when the client sends/receives a sync message
  provider.on('sync', () => {
    // After connected state, the first "sync" after "connected" means initial sync complete
  });

  return {
    destroy() {
      if (confirmTimer !== null) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.destroy();
    },
  };
}
