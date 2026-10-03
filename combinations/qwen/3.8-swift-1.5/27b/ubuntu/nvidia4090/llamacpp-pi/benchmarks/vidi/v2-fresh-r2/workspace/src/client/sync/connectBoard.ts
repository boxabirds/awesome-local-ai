/**
 * Client board connection: a y-websocket WebsocketProvider against the
 * Worker route /api/rooms, mapped to a small ConnectionState the UI renders.
 *
 * State mapping:
 * - provider created                     → 'connecting'
 * - connected + synced, first time       → 'connected'
 * - disconnected after having connected  → 'reconnecting'
 * - re-synced after 'reconnecting'       → 'confirmed' for
 *   CONNECTED_CONFIRMATION_MS, then 'connected'
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load-failed';
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Structural view of the provider so tests can inject a fake event emitter.
 */
export interface ProviderLike {
  on(event: 'status', handler: (event: { status: ProviderStatus }) => void): unknown;
  on(event: 'sync', handler: (state: boolean) => void): unknown;
  off(event: string, handler: unknown): void;
  destroy(): void;
  /** The live WebSocket, if any (used to simulate a network drop in tests). */
  ws?: {
    close(code?: number, reason?: string): void;
    readonly readyState: number;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  } | null;
}

export interface ConnectBoardDeps {
  createProvider?: (
    url: string,
    boardId: string,
    doc: Y.Doc,
    options: { maxBackoffTime: number; disableBc: boolean },
  ) => ProviderLike;
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  deps: ConnectBoardDeps = {},
): {
  destroy(): void;
  disconnect(): void;
  debug(): { wsReadyState: number | null; wsconnected?: boolean; wsconnecting?: boolean };
  forceLoadFailed(): void;
  forceRecovered(): void;
} {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${window.location.host}/api/rooms`;
  const createProvider =
    deps.createProvider ??
    ((u: string, id: string, d: Y.Doc, o: { maxBackoffTime: number; disableBc: boolean }) =>
      new WebsocketProvider(u, id, d, o));

  let providerStatus: ProviderStatus = 'connecting';
  let synced = false;
  let hasConnected = false;
  let confirmTimer: number | undefined;
  let loadFailed = false;

  const set = (s: ConnectionState) => onState(s);

  const provider = createProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const evaluate = () => {
    if (loadFailed) return; // No further state changes after load failure
    if (providerStatus === 'connected' && synced) {
      if (confirmTimer !== undefined) {
        window.clearTimeout(confirmTimer);
        confirmTimer = undefined;
      }
      if (!hasConnected) {
        hasConnected = true;
        set('connected');
      } else {
        set('confirmed');
        confirmTimer = window.setTimeout(() => {
          confirmTimer = undefined;
          set('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    } else if (providerStatus === 'disconnected' && hasConnected) {
      if (confirmTimer !== undefined) {
        window.clearTimeout(confirmTimer);
        confirmTimer = undefined;
      }
      set('reconnecting');
    }
    // 'connecting' keeps the current state (initial 'connecting' or 'reconnecting')
  };

  const onStatus = (event: { status: ProviderStatus }) => {
    providerStatus = event.status;
    evaluate();
  };
  const onSync = (state: boolean) => {
    synced = state;
    evaluate();
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  // Detect load-failure close code from the server.
  const ws = provider.ws;
  if (ws) {
    const onWsClose = (e: Event) => {
      const closeEvent = e as CloseEvent;
      if (closeEvent.code === CLOSE_BOARD_LOAD_FAILED) {
        loadFailed = true;
        set('load-failed');
      }
    };
    ws.addEventListener('close', onWsClose);
    // Store cleanup reference
    (provider as unknown as { _onWsClose?: () => void })._onWsClose = () => {
      ws.removeEventListener('close', onWsClose);
    };
  }

  return {
    destroy() {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      if (confirmTimer !== undefined) {
        window.clearTimeout(confirmTimer);
        confirmTimer = undefined;
      }
      (provider as unknown as { _onWsClose?: () => void })._onWsClose?.();
      provider.destroy();
    },
    /** Close the current WebSocket to simulate a network drop. */
    disconnect() {
      provider.ws?.close();
    },
    /** Debug: expose the provider's socket state. */
    debug() {
      const p = provider as unknown as { wsconnected?: boolean; wsconnecting?: boolean };
      return { wsReadyState: provider.ws?.readyState ?? null, wsconnected: p.wsconnected, wsconnecting: p.wsconnecting };
    },
    /** Force the load-failed state (test only). */
    forceLoadFailed() {
      loadFailed = true;
      set('load-failed');
    },
    /** Force recovery from load-failed state (test only). */
    forceRecovered() {
      loadFailed = false;
      hasConnected = true;
      providerStatus = 'connected';
      synced = true;
      set('connected');
    },
  };
}
