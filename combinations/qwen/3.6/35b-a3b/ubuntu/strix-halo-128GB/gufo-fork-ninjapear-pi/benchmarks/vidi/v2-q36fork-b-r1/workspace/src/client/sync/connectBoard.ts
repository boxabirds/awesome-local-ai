/**
 * Client-side connection helper.
 * Story 3 — live collaboration.
 * Story 4 — persistence states (load-failed, storage-failed).
 *
 * Creates a y-websocket WebsocketProvider connecting to the BoardRoom
 * and maps provider status events to ConnectionState values used by
 * the ConnectionStatus badge component.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { WebsocketProvider as WSPType } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '@/shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load-failed'
  | 'storage-failed';

const LOAD_OK_CODES = new Set([0, 1000, 1001]); // Normal closure codes
const RECOVERABLE_ERRORS = new Set([1006, 1012, 1013]); // Abnormal / server restart

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
      disableBc: true,
    },
  );

  let currentState: ConnectionState = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(state: ConnectionState): void {
    if (state === currentState) return;
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    currentState = state;
    onState(state);
  }

  // --- Provider event wiring ---
  provider.on('status', (event: { status: string }) => {
    switch (event.status) {
      case 'connecting':
        setState('connecting');
        break;
      case 'connected':
        if (currentState === 'connecting') {
          setState('connected');
        } else if (currentState === 'reconnecting') {
          setState('confirmed');
          confirmTimer = setTimeout(() => {
            setState('connected');
            confirmTimer = null;
          }, CONNECTED_CONFIRMATION_MS);
        }
        break;
      case 'disconnected':
        if (currentState === 'connected' || currentState === 'confirmed') {
          setState('reconnecting');
        }
        break;
    }
  });

  // Handle WebSocket close codes for persistence error states
  provider.on('connection-close', (event: CloseEvent | null) => {
    if (!event) return;
    const code = event.code;
    const reason = event.reason ?? '';

    // Load failed: server couldn't reconstruct document from storage
    if (code === CLOSE_BOARD_LOAD_FAILED || reason.includes('Loading failed')) {
      setState('load-failed');
      return;
    }

    // Storage failure: write operations can no longer be persisted
    if (code === CLOSE_STORAGE_FAILURE || reason.includes('Storage failure')) {
      setState('storage-failed');
      return;
    }

    // Recoverable errors → stay in reconnecting (provider auto-reconnects)
    if (!LOAD_OK_CODES.has(code) && RECOVERABLE_ERRORS.has(code)) {
      // Don't change state — provider handles reconnection
    }
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
