// The single place the browser opens the y-websocket connection. It owns the
// WebsocketProvider (the one place y-websocket is imported on the client) and
// keeps the connection concerns out of the document hook.

import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config.ts';

export interface BoardConnection {
  provider: WebsocketProvider;
  awareness: Awareness;
  destroy(): void;
}

interface ConnectOptions {
  // Injectable only so unit tests can drive the transport deterministically;
  // production passes nothing and y-websocket uses the global WebSocket.
  WebSocketPolyfill?: unknown;
}

/**
 * The y-websocket server base (the room endpoint minus the room name). The
 * provider appends `/<boardId>`, producing `/api/rooms/<boardId>`.
 */
export function wsServerUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.VITE_WS_URL) return env.VITE_WS_URL;
  if (typeof window !== 'undefined' && window.location && window.location.host) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/rooms`;
  }
  return 'ws://localhost:8787/api/rooms';
}

/**
 * Open (and own) the y-websocket connection for `boardId`. The provider's
 * reconnect backoff is capped at RECONNECT_MAX_BACKOFF_MS, and y-websocket's
 * default `shouldReconnect` already refuses to reconnect after a server close
 * code in 4400..4499. BroadcastChannel is disabled: the room relays everything.
 */
export function connectBoard(
  boardId: string,
  doc: Y.Doc,
  opts: ConnectOptions = {},
): BoardConnection {
  const options: Record<string, unknown> = {
    connect: false,
    disableBc: true,
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
  };
  if (opts.WebSocketPolyfill !== undefined) {
    options.WebSocketPolyfill = opts.WebSocketPolyfill;
  }
  const provider = new WebsocketProvider(
    wsServerUrl(),
    boardId,
    doc,
    options as ConstructorParameters<typeof WebsocketProvider>[3],
  );
  provider.shouldConnect = true;
  provider.connect();

  return {
    provider,
    awareness: provider.awareness,
    destroy() {
      provider.disconnect();
      provider.destroy();
    },
  };
}
