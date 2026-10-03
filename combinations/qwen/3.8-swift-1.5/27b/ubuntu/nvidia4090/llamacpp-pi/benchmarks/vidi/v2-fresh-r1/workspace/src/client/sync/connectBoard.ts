// Client connection to the board room: wraps a y-websocket provider and
// maps its status/sync events onto the UI connection state machine.
//
// State machine (design.md `sync.client`):
//   connecting   - before the first successful sync
//   connected    - first sync reached (badge hidden)
//   reconnecting - socket lost after having connected
//   confirmed    - socket back after a reconnect; visible for
//                  CONNECTED_CONFIRMATION_MS, then back to `connected`

import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionMapper {
  onStatus(status: ProviderStatus): void;
  onSynced(synced: boolean): void;
  onCloseCode(code: number): void;
  destroy(): void;
}

/**
 * Pure state machine over provider events; extracted so component tests can
 * drive it with fake timers and scripted status feeds.
 */
export function createConnectionMapper(onState: (s: ConnectionState) => void): ConnectionMapper {
  let wsConnected = false;
  let synced = false;
  let everConnected = false;
  let isReconnecting = false;
  let confirmTimer: number | null = null;

  const clearConfirmTimer = () => {
    if (confirmTimer !== null) {
      window.clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  let loadFailed = false;

  const tryConnect = () => {
    if (!wsConnected || !synced) return;
    if (loadFailed) {
      // Recovery from load_failed: the board loaded successfully.
      loadFailed = false;
      onState('connected');
      return;
    }
    if (!everConnected) {
      everConnected = true;
      onState('connected');
    } else if (isReconnecting) {
      isReconnecting = false;
      onState('confirmed');
      clearConfirmTimer();
      confirmTimer = window.setTimeout(() => {
        confirmTimer = null;
        onState('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  return {
    onStatus(status) {
      clearConfirmTimer();
      if (status === 'connected') {
        wsConnected = true;
        tryConnect();
      } else if (status === 'disconnected') {
        wsConnected = false;
        if (everConnected) {
          isReconnecting = true;
          onState('reconnecting');
        }
      } else {
        // 'connecting'
        wsConnected = false;
        if (!everConnected && !loadFailed) onState('connecting');
      }
    },
    onSynced(v) {
      synced = v;
      tryConnect();
    },
    /** Called when the server closes the socket with a specific code. */
    onCloseCode(code: number) {
      if (code === 4500) {
        // Board load failed on the server side.
        loadFailed = true;
        wsConnected = false;
        synced = false;
        onState('load_failed');
      }
      // 1011 and 1003 are handled by the normal 'disconnected' status
      // (y-websocket emits 'disconnected' when the socket closes).
    },
    destroy() {
      clearConfirmTimer();
    },
  };
}

/**
 * Connect `doc` to the room for `boardId`. Reports state transitions via
 * `onState`. Returns `destroy()` to tear the provider down (unmount /
 * board change).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsOrigin = `${protocol}://${window.location.host}`;
  const mapper = createConnectionMapper(onState);
  const provider = new WebsocketProvider(`${wsOrigin}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  // y-websocket emits its events with a single-element array payload
  // (`[{ status }]`, `[synced]`), so normalise before mapping.
  provider.on('status', (e: unknown) => {
    const first = Array.isArray(e) ? e[0] : e;
    const status = (first as { status?: string } | undefined)?.status;
    if (status === 'connecting' || status === 'connected' || status === 'disconnected') {
      mapper.onStatus(status);
    }
  });
  provider.on('sync', (e: unknown) => {
    const synced = Array.isArray(e) ? e[0] : e;
    if (typeof synced === 'boolean') mapper.onSynced(synced);
  });
  // Listen for WebSocket close events to detect server-side load failures.
  const ws = (provider as unknown as { ws?: WebSocket }).ws;
  const onClose = (ev: CloseEvent) => {
    mapper.onCloseCode(ev.code);
  };
  if (ws) {
    ws.addEventListener('close', onClose);
  } else {
    // The WebSocket may not be available immediately; poll for it.
    const checkWs = setInterval(() => {
      const w = (provider as unknown as { ws?: WebSocket }).ws;
      if (w) {
        clearInterval(checkWs);
        w.addEventListener('close', onClose);
      }
    }, 50);
    // Clean up the interval when the provider is destroyed.
    const origDestroy = provider.destroy.bind(provider);
    (provider as unknown as { destroy: () => void }).destroy = () => {
      clearInterval(checkWs);
      origDestroy();
    };
  }

  if (import.meta.env.MODE === 'test') {
    // Exposed for e2e outage tests: Playwright's setOffline() does not tear
    // down established WebSockets, so tests close it explicitly too.
    (window as unknown as { __vidi6Provider?: unknown }).__vidi6Provider = provider;
    // Expose Yjs for e2e tests that need to manipulate the doc directly.
    (window as unknown as { __Y?: unknown }).__Y = Y;
  }
  return {
    destroy() {
      provider.off('status', () => undefined);
      provider.off('sync', () => undefined);
      provider.destroy();
      mapper.destroy();
    },
  };
}
