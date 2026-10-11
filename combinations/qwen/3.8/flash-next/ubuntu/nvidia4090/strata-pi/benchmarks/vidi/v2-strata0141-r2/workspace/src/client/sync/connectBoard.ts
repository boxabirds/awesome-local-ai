import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * The browser's connection to a board room (`sync.client`).
 *
 * One `WebsocketProvider` per board, attached to the same `Y.Doc` the board
 * model uses. The provider owns reconnection; this module only maps what the
 * provider reports onto the four states the badge shows.
 */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The part of a provider this module depends on (a fake is enough for tests). */
export interface BoardProvider {
  synced: boolean;
  on(event: 'status', handler: (event: { status: string }) => void): void;
  on(event: 'status', handler: (event: { status: string }) => void): void;
  on(event: 'synced', handler: (synced: boolean) => void): void;
  off(event: 'status', handler: (event: { status: string }) => void): void;
  off(event: 'synced', handler: (synced: boolean) => void): void;
  destroy(): void;
}

export type ProviderFactory = (doc: Y.Doc, boardId: string) => BoardProvider;

export interface BoardConnection {
  readonly state: ConnectionState;
  /** Detaches the provider; called on unmount or when the board changes. */
  destroy(): void;
}

export interface ConnectBoardOptions {
  /** Injectable for component tests; defaults to the real y-websocket provider. */
  providerFactory?: ProviderFactory;
}

/** `wss:` on an https page, `ws:` otherwise; the room route lives under /api/rooms. */
export function roomOrigin(): string {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1';
  }
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/rooms`;
}

function defaultProviderFactory(doc: Y.Doc, boardId: string): BoardProvider {
  const provider = new WebsocketProvider(roomOrigin(), boardId, doc, {
    connect: true,
    // Idle clients renew their awareness, the room relays it back, and a
    // provider that hears nothing would reconnect. Keep that backoff bounded.
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Tabs of the same browser must not sync around the server: every test and
    // every real session goes through the room.
    disableBc: true,
  });
  return provider as unknown as BoardProvider;
}

/**
 * Test-only window hook (`window.__vidi6.connectionState`), used by the e2e
 * suites to read the mapped state instead of guessing it from the badge.
 */
function publishToTestHook(state: ConnectionState): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  const target = window as unknown as {
    __vidi6?: { connectionState?: ConnectionState; connectionLog?: { state: ConnectionState; at: number }[] };
  };
  const log = target.__vidi6?.connectionLog ?? [];
  target.__vidi6 = {
    ...target.__vidi6,
    connectionState: state,
    // Every state the connection has been through, so a test can prove a state
    // was never reached rather than only checking the one it happens to catch.
    connectionLog: [...log, { state, at: Date.now() }],
  };
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): BoardConnection {
  const provider = (options.providerFactory ?? defaultProviderFactory)(doc, boardId);
  let state: ConnectionState = 'connecting';
  let hasBeenSynced = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: ConnectionState): void => {
    if (next === state) {
      return;
    }
    state = next;
    publishToTestHook(next);
    onState(next);
  };

  const cancelConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const onSynced = (): void => {
    if (!hasBeenSynced) {
      // First load: the board is ready, no "Connected" flash.
      hasBeenSynced = true;
      setState('connected');
      return;
    }
    // A reconnection that caught up: show it, then get out of the way.
    cancelConfirmation();
    setState('confirmed');
    confirmationTimer = setTimeout(() => {
      confirmationTimer = null;
      setState('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  const onStatus = (event: { status: string }): void => {
    if (event.status === 'connected') {
      if (provider.synced) {
        onSynced();
      }
      return;
    }
    cancelConfirmation();
    setState(hasBeenSynced ? 'reconnecting' : 'connecting');
  };

  provider.on('status', onStatus);
  provider.on('synced', onSynced);
  publishToTestHook(state);

  return {
    get state(): ConnectionState {
      return state;
    },
    destroy(): void {
      cancelConfirmation();
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.destroy();
    },
  };
}
