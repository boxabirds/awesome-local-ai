/**
 * Client connection to the board room (story 3, design sync.client).
 *
 * `connectBoard` attaches a y-websocket `WebsocketProvider` to the board's
 * Y.Doc and maps the provider's status/sync events onto the
 * ConnectionState shown by the ConnectionStatus badge:
 *
 *   connecting  -> initial load, before first sync
 *   connected   -> socket open and synced (badge hidden)
 *   reconnecting-> socket lost after having connected (amber badge)
 *   confirmed   -> just reconnected; green "Connected" for
 *                  CONNECTED_CONFIRMATION_MS, then back to connected
 *
 * The board stays fully editable in every state: edits go into the local
 * Y.Doc and are exchanged on (re)connect.
 */

import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * Handle returned by connectBoard: tear down, or drive a simulated network
 * outage (drop the socket / bring it back). The outage pair is exposed to the
 * window.__vidi6 test hook for the e2e flaky-Wi-Fi test (TC-27).
 */
export interface BoardConnection {
  destroy(): void;
  /** Drop the live socket (simulates the network going away). */
  dropSocket(): void;
  /** Bring the socket back (simulates the network returning). */
  resumeSocket(): void;
}

/**
 * The slice of the y-websocket provider the state mapping needs. Extracted
 * so the mapping is testable with a fake provider event emitter (design
 * TC-19 to TC-21) without a real socket.
 */
export interface ProviderLike {
  on(
    event: 'status',
    handler: (event: { status: 'connecting' | 'connected' | 'disconnected' }) => void,
  ): void;
  on(event: 'sync', handler: (state: boolean) => void): void;
  destroy(): void;
}

/**
 * Maps a provider's status/sync events onto ConnectionState, calling
 * `onState` on every transition (and once immediately with the initial
 * state, 'connecting'). Returns `destroy()`.
 */
export function createConnectionState(
  provider: ProviderLike,
  onState: (state: ConnectionState) => void,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let wsConnected = false;
  let synced = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: ConnectionState): void => {
    if (next === state) {
      return;
    }
    state = next;
    onState(next);
  };

  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const tryLive = (): void => {
    if (!wsConnected || !synced) {
      return;
    }
    if (state === 'connecting') {
      emit('connected');
    } else if (state === 'reconnecting') {
      emit('confirmed');
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        emit('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  const handleStatus = ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }): void => {
    clearConfirmation();
    if (status === 'connected') {
      wsConnected = true;
      tryLive();
    } else {
      wsConnected = false;
      // A socket loss (or a fresh connect attempt) after having been live
      // means "reconnecting"; the initial load stays "connecting".
      if (state === 'connected' || state === 'confirmed') {
        emit('reconnecting');
      }
    }
  };

  const handleSync = (sync: boolean): void => {
    synced = sync;
    if (sync) {
      tryLive();
    }
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);

  // The initial state is reported immediately (design sync.client).
  onState('connecting');

  return {
    destroy: (): void => {
      clearConfirmation();
      provider.destroy();
    },
  };
}

/**
 * Connects the board doc to its room over WebSockets and reports the
 * mapped connection state. `destroy()` tears the provider down (unmount or
 * board change).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(
    `${protocol}://${window.location.host}/api/rooms`,
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      // Same-browser tabs must not sync around the server (tests and
      // product behaviour go through the room).
      disableBc: true,
    },
  );
  const connection = createConnectionState(provider, onState);
  return {
    destroy: connection.destroy,
    /**
     * Simulates the network going away. A graceful WebSocket close cannot be
     * relied on here: workerd's local dev server does not complete the close
     * handshake (the socket stays CLOSING and the provider's 'disconnected'
     * status never fires), and Chromium's offline emulation does not sever
     * established sockets. `provider.disconnect()` instead forces the
     * provider's disconnect path synchronously (status 'disconnected'). The
     * e2e outage test (TC-27) combines it with context.setOffline so the
     * window reads as a genuine outage.
     */
    dropSocket: (): void => {
      provider.disconnect();
    },
    /** Simulates the network returning: resumes the provider's connection. */
    resumeSocket: (): void => {
      provider.connect();
    },
  };
}
