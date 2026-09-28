import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  destroy(): void;
}

/**
 * Creates a WebsocketProvider and maps its status/sync events to our ConnectionState.
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
        setState('reconnecting');
      }
    } else if (status === 'connecting') {
      if (!hasEverConnected) {
        setState('connecting');
      }
    }
  };

  const syncHandler = (state: boolean) => {
    if (state && !hasEverConnected) {
      hasEverConnected = true;
      setState('connected');
    }
  };

  provider.on('status', statusHandler as (...args: unknown[]) => void);
  provider.on('sync', syncHandler as (...args: unknown[]) => void);

  // Expose for testing (e2e tests use this to simulate disconnection and check state)
  const hooks = (window as any).__vidi6 ??= {};
  hooks.provider = provider;
  hooks.connectionState = currentState;


  return {
    destroy(): void {
      if (confirmationTimer) clearTimeout(confirmationTimer);
      provider.off('status', statusHandler as (...args: unknown[]) => void);
      provider.off('sync', syncHandler as (...args: unknown[]) => void);
      provider.destroy();
      const h = (window as any).__vidi6;
      if (h) {
        delete h.provider;
        delete h.connectionState;
      }
    },
  };
}
