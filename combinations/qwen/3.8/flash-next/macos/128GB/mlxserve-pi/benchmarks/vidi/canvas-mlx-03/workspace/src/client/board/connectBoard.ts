// The single place the browser opens the y-websocket connection. It owns the
// WebsocketProvider (the one place y-websocket is imported on the client) and
// keeps the connection concerns out of the document hook.

import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS } from '../../shared/config.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol.ts';
import type { ProviderSignal } from './useConnectionBadge.ts';

export interface BoardConnection {
  provider: WebsocketProvider;
  awareness: Awareness;
  /**
   * Subscribe to the badge signal produced by a socket close: `load-failed` for
   * CLOSE_BOARD_LOAD_FAILED, `disconnected` for everything else. Returns an
   * unsubscribe function.
   */
  onCloseSignal(cb: (signal: ProviderSignal) => void): () => void;
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
 * Map a socket close code to the badge signal it implies. Only the room's
 * explicit "this board could not be loaded" code is a load failure; a storage
 * write failure (1011), a network drop (1006) or anything unrecognised is an
 * ordinary disconnection, because the board itself is still readable and the
 * room will retry (persist.save_failure).
 */
export function closeCodeToSignal(code: number): ProviderSignal {
  return code === CLOSE_BOARD_LOAD_FAILED ? 'load-failed' : 'disconnected';
}

/**
 * Open (and own) the y-websocket connection for `boardId`. The provider's
 * reconnect backoff is capped at RECONNECT_MAX_BACKOFF_MS.
 *
 * Reconnection uses y-websocket's default policy, which treats the server's
 * 4400–4499 sub-range as permanent and everything else — including our
 * CLOSE_BOARD_LOAD_FAILED (4500, the "try again later" range) and the storage
 * failure code 1011 — as transient. That is exactly what story 4 needs: the
 * client keeps retrying with the story 3 backoff until the room can load the
 * board, without a page reload. BroadcastChannel is disabled: the room relays
 * everything.
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

  const listeners = new Set<(signal: ProviderSignal) => void>();
  // The room's reason for closing the socket is the only thing that can put the
  // badge into `load_failed`, so the close code is interpreted once, here. A null
  // event is a close we asked for (provider.disconnect()), never a load failure.
  provider.on('connection-close', (event: { code: number } | null) => {
    const signal = closeCodeToSignal(event?.code ?? 1006);
    for (const cb of [...listeners]) cb(signal);
  });

  provider.connect();

  return {
    provider,
    awareness: provider.awareness,
    onCloseSignal(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      provider.disconnect();
      provider.destroy();
      listeners.clear();
    },
  };
}
