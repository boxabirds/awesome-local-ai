import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

export interface ConnectionHandle {
  destroy(): void;
}

/**
 * Returns true when the user can edit the board.
 * Returns false only for 'load_failed' state.
 */
export function canEdit(state: ConnectionState | undefined): boolean {
  if (state === undefined) return true;
  return state !== 'load_failed';
}

/**
 * Create a WebsocketProvider for a board and map its events to a ConnectionState.
 *
 * State mapping:
 * - provider 'connecting' before first sync → 'connecting'
 * - provider 'connected' + synced(true) → 'connected'
 * - provider 'disconnect' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS → 'connected'
 * - close code CLOSE_BOARD_LOAD_FAILED (4500) → 'load_failed'
 * - close code 1011 (CLOSE_STORAGE_FAILURE) or 1003 → 'reconnecting'
 * - first successful sync after 'load_failed' → 'connected'
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): ConnectionHandle {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${wsProtocol}//${location.host}/api/rooms`;

  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasBeenConnected = false;
  let isLoadingFailed = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmationTimer = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const emitState = (state: ConnectionState) => {
    onState(state);
  };

  const handleStatus = (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    if (event.status === 'disconnected') {
      clearConfirmationTimer();
      if (isLoadingFailed) {
        // Stay in load_failed state; the provider keeps retrying automatically
        return;
      }
      if (hasBeenConnected) {
        emitState('reconnecting');
      }
      // If never connected, stay in 'connecting' (initial load)
    } else if (event.status === 'connected') {
      // Socket is open but not yet synced; wait for sync event
    } else {
      // 'connecting'
      if (!hasBeenConnected && !isLoadingFailed) {
        emitState('connecting');
      }
    }
  };

  const handleSync = (synced: boolean) => {
    if (synced) {
      if (isLoadingFailed) {
        // Recovered from load_failed: editing re-enabled without reload
        isLoadingFailed = false;
        hasBeenConnected = true;
        emitState('connected');
      } else if (!hasBeenConnected) {
        hasBeenConnected = true;
        emitState('connected');
      } else {
        // Reconnected: show 'confirmed' for CONNECTED_CONFIRMATION_MS
        clearConfirmationTimer();
        emitState('confirmed');
        confirmationTimer = setTimeout(() => {
          confirmationTimer = null;
          emitState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    }
  };

  const handleClose = (event: { code: number } | null) => {
    if (event?.code === CLOSE_BOARD_LOAD_FAILED) {
      isLoadingFailed = true;
      emitState('load_failed');
    }
    // 1011 (CLOSE_STORAGE_FAILURE) and 1003 (CLOSE_UNSUPPORTED_DATA) map to 'reconnecting'
    // which is handled by the 'status' handler's 'disconnected' event
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);
  provider.on('connection-close', handleClose);

  // If already connected and synced (unlikely on creation but handle edge case)
  if (provider.wsconnected && provider.synced) {
    hasBeenConnected = true;
    emitState('connected');
  } else {
    emitState('connecting');
  }

  return {
    destroy() {
      clearConfirmationTimer();
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
      provider.off('connection-close', handleClose);
      provider.destroy();
    },
  };
}
