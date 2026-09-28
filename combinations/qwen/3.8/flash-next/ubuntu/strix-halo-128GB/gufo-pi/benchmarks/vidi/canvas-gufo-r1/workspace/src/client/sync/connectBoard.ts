import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

export interface BoardConnection {
  destroy(): void;
}

/**
 * Returns true if the board is editable in this connection state.
 * Editing is disabled only when the server explicitly refused to load the board.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * Creates a WebsocketProvider and maps its status/sync/connection-close events to our ConnectionState.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${protocol}//${window.location.host}/api/rooms`;

  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasEverConnected = false;
  let currentState: ConnectionState = 'connecting';
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(s: ConnectionState): void {
    if (s === currentState) return;
    currentState = s;
    onState(s);
    const hooks = (window as any).__vidi6 ??= {};
    hooks.connectionState = s;
  }

  const statusHandler = ({ status }: { status: string }) => {
    if (status === 'connected') {
      if (hasEverConnected) {
        // Reconnected after a disconnect — show confirmed
        setState('confirmed');
        if (confirmationTimer) clearTimeout(confirmationTimer);
        confirmationTimer = setTimeout(() => {
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        // First connection — wait for sync before declaring connected
        // (handled in sync handler)
      }
    } else if (status === 'disconnected') {
      if (hasEverConnected) {
        if (confirmationTimer) {
          clearTimeout(confirmationTimer);
          confirmationTimer = null;
        }
        // Don't downgrade from load_failed to reconnecting
        if (currentState !== 'load_failed') {
          setState('reconnecting');
        }
      }
    } else if (status === 'connecting') {
      if (!hasEverConnected) {
        setState('connecting');
      }
    }
  };

  const syncHandler = (state: boolean) => {
    if (state) {
      if (!hasEverConnected) {
        hasEverConnected = true;
        setState('connected');
      } else if (currentState === 'load_failed') {
        // Recovered from load failure: first successful sync re-enables editing
        setState('connected');
      }
    }
  };

  const connectionCloseHandler = (event: { code: number } | null) => {
    if (!event) return;
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      setState('load_failed');
    } else if (event.code === CLOSE_STORAGE_FAILURE) {
      // Storage failure: board is readable, changes re-sent on reconnect
      setState('reconnecting');
    }
  };

  provider.on('status', statusHandler as (...args: unknown[]) => void);
  provider.on('sync', syncHandler as (...args: unknown[]) => void);
  provider.on('connection-close', connectionCloseHandler as (...args: unknown[]) => void);

  // Expose for testing (e2e tests use this to simulate disconnection and check state)
  const hooks = (window as any).__vidi6 ??= {};
  hooks.provider = provider;
  hooks.connectionState = currentState;

  return {
    destroy(): void {
      if (confirmationTimer) clearTimeout(confirmationTimer);
      provider.off('status', statusHandler as (...args: unknown[]) => void);
      provider.off('sync', syncHandler as (...args: unknown[]) => void);
      provider.off('connection-close', connectionCloseHandler as (...args: unknown[]) => void);
      provider.destroy();
      const h = (window as any).__vidi6;
      if (h) {
        delete h.provider;
        delete h.connectionState;
      }
    },
  };
}
