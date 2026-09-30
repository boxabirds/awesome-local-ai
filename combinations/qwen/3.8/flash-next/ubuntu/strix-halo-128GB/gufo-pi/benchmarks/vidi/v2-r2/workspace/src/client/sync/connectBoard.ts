import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '@shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

export interface BoardConnection {
  destroy(): void;
}

// A minimal view of y-websocket's WebsocketProvider so the state machine can be
// unit-tested with a fake emitter (no real socket). WebsocketProvider satisfies
// this structurally (its `on`/`off` come from lib0's Observable).
export interface ProviderEmitter {
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  wsconnected?: boolean;
}

/**
 * Wire a provider's connection events to a ConnectionState callback.
 *
 * - First sync  -> connected
 * - Disconnect  -> reconnecting
 * - Reconnect + sync -> confirmed -> connected
 * - Provider close with CLOSE_BOARD_LOAD_FAILED (4500) -> load_failed (board
 *   refused to load; the provider keeps retrying, and a later sync recovers).
 * - Any other close code (e.g. 1011 storage failure, 1003) -> reconnecting, never
 *   load_failed, so a transient storage error does not lock editing.
 *
 * Returns a teardown function that removes the listeners.
 */
export function wireConnection(
  provider: ProviderEmitter,
  onState: (s: ConnectionState) => void,
): () => void {
  let hasBeenConnected = false;
  let isReconnecting = false;
  let loadFailed = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmationTimer = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const handleStatus = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    if (event.status === 'disconnected') {
      // Do not clobber an explicit load_failed with a generic "reconnecting".
      if (hasBeenConnected && !loadFailed) {
        clearConfirmationTimer();
        isReconnecting = true;
        onState('reconnecting');
      }
    }
  };

  const handleSync = (synced: boolean) => {
    if (!synced) return;

    if (!hasBeenConnected) {
      hasBeenConnected = true;
      loadFailed = false;
      onState('connected');
    } else if (isReconnecting) {
      isReconnecting = false;
      loadFailed = false;
      clearConfirmationTimer();
      onState('confirmed');
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        if (provider.wsconnected) onState('connected');
      }, CONNECTED_CONFIRMATION_MS);
    } else if (loadFailed) {
      // Recovered from a load failure on a later retry: sync completed normally.
      loadFailed = false;
      onState('connected');
    }
  };

  const handleClose = (event?: { code?: number }) => {
    clearConfirmationTimer();
    if (event && event.code === CLOSE_BOARD_LOAD_FAILED) {
      loadFailed = true;
      onState('load_failed');
      return;
    }
    // Any other close: the provider keeps retrying; show reconnecting, not load_failed.
    isReconnecting = hasBeenConnected;
    onState('reconnecting');
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);
  provider.on('connection-close', handleClose);

  return () => {
    clearConfirmationTimer();
    provider.off('status', handleStatus);
    provider.off('sync', handleSync);
    provider.off('connection-close', handleClose);
  };
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsOrigin = `${protocol}//${location.host}`;
  const url = `${wsOrigin}/api/rooms`;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
    connect: true,
  });

  const teardown = wireConnection(provider as unknown as ProviderEmitter, onState);

  return {
    destroy() {
      teardown();
      provider.destroy();
    },
  };
}
