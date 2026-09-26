// Client sync (sync.client).
//
// connectBoard wires a y-websocket WebsocketProvider to the board's Y.Doc and
// translates the provider's raw events into a small, testable connection state
// machine:
//
//   connecting  → (first sync) → connected            [badge hidden]
//   any state   → (socket lost) → reconnecting        [amber]
//   reconnecting → (re-synced) → confirmed            [green, CONNECTED_CONFIRMATION_MS]
//   confirmed   → (timer) → connected                 [badge hidden]
//
// The provider emits `status: 'connected'` as soon as the socket OPENS (not
// when it is synced), so the machine requires BOTH the socket to be up AND
// `provider.synced` before it reports a connected/confirmed state.
//
// `resyncInterval` keeps an otherwise-idle link talking: the provider resends
// SyncStep1 every IDLE_KEEPALIVE_MS and the room answers with SyncStep2, so
// y-websocket's 30-second "no message received" timeout never fires on a quiet
// board (that timeout would otherwise bounce an idle connection through
// Reconnecting every 30s).

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  CONNECTED_CONFIRMATION_MS,
  IDLE_KEEPALIVE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';

/** The connection states the UI distinguishes. */
export type ConnectionState = 'connecting' | 'reconnecting' | 'confirmed' | 'connected';

/** The slice of WebsocketProvider the state machine consumes (a fake with the
 * same surface drives the component tests). */
export interface ProviderLike {
  /** Only used through events; the machine tracks the socket state itself. */
  synced: boolean;
  // The real WebsocketProvider emits 'status' with a single object argument
  // ({status: 'connected'|'disconnected'|'connecting'}); fake test emitters
  // may pass the bare string. Both shapes are handled.
  on(event: 'status' | 'synced', listener: (...args: any[]) => void): void;
  off(event: 'status' | 'synced', listener: (...args: any[]) => void): void;
  destroy(): void;
  /** Optional reconnect hooks (the real provider has connect/disconnect).
   * Fired when the browser reports the network went away / came back. */
  connect?(): void;
  disconnect?(): void;
}

/** Minimal timer surface so tests can use fake timers. */
export interface Scheduler {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The connection state machine over a provider. `state` is updated before
 * `onState` is called; duplicate notifications are suppressed (only real
 * transitions fire).
 */
export function createConnectionMonitor(
  provider: ProviderLike,
  onState: (state: ConnectionState) => void,
  scheduler: Scheduler = realScheduler,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let socketUp = false;
  let everSynced = false;
  let timer: unknown = null;

  const set = (next: ConnectionState) => {
    if (state === next) return;
    state = next;
    onState(next);
  };

  const clearTimer = () => {
    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
  };

  const syncedNow = () => {
    if (!everSynced) {
      // First sync of the session: trust the link and hide the badge.
      everSynced = true;
      set('connected');
      return;
    }
    // A re-sync (initial or after a drop) shows the green badge for
    // CONNECTED_CONFIRMATION_MS before going quiet again.
    clearTimer();
    set('confirmed');
    timer = scheduler.setTimeout(() => {
      timer = null;
      set('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  const onStatus = (...args: any[]) => {
    const first = args[0];
    const status: string | undefined =
      typeof first === 'string' ? first : first && typeof first === 'object' ? (first as { status?: string }).status : undefined;
    if (status === 'disconnected') {
      clearTimer();
      socketUp = false;
      set('reconnecting');
    } else if (status === 'connected') {
      socketUp = true;
      if (provider.synced) syncedNow();
    }
  };

  const onSynced = (...args: any[]) => {
    if (args[0] === true && socketUp && provider.synced) syncedNow();
  };

  provider.on('status', onStatus);
  provider.on('synced', onSynced);

  // Browser-level link loss (flaky Wi-Fi, airplane mode): Chromium fires
  // 'offline' even when the socket is merely black-holed (no RST/close ever
  // reaches us), so the badge must trust the browser's network state too.
  const onOffline = () => {
    clearTimer();
    socketUp = false;
    set('reconnecting');
    // Tear down a socket that the browser reports as unroutable — under a
    // black-holed connection it would otherwise stay 'open' forever.
    try {
      provider.disconnect?.();
    } catch {
      /* ignore; the machine is already in reconnecting */
    }
  };
  const onOnline = () => {
    // Network is back. Two cases: (a) no stale socket — a normal reconnect
    // via connect(); (b) a black-holed socket stuck in CLOSING (close() was
    // called while offline but the stack never completed, and the provider
    // refuses to open a replacement while it holds one). In case (b) we
    // deliver the close event the browser will never send; y-websocket then
    // drops the zombie and rebuilds the connection via its normal path.
    try {
      provider.connect?.();
      const stale = provider as unknown as {
        ws?: { readyState: number; onclose?: ((event: unknown) => void) | null };
      };
      const ws = stale.ws;
      if (ws && ws.readyState === 2 && ws.onclose) {
        ws.onclose({ code: 1006, reason: 'link lost while offline' });
      }
    } catch {
      /* provider may reject a connect while mid-handshake; the keepalive
         retry loop covers it */
    }
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
  }

  return {
    destroy() {
      clearTimer();
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('online', onOnline);
      }
    },
  };
}

export interface ConnectBoardOptions {
  /** Build the provider (tests inject a fake provider emitter here). */
  providerFactory?: (
    serverUrl: string,
    boardId: string,
    doc: Y.Doc,
  ) => ProviderLike;
  /** Override the provider creation entirely (component tests). */
  scheduler?: Scheduler;
}

/**
 * Create the sync connection for `boardId`. The provider URL is
 * `<ws|wss>://<host>/api/rooms`, and y-websocket appends `/<boardId>`, so the
 * socket path is exactly the Worker route `/api/rooms/:boardId`.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): { destroy(): void; provider: ProviderLike } {
  const makeProvider =
    options.providerFactory ??
    ((_serverUrl: string, room: string, d: Y.Doc) => {
      const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
      const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
      const url = `${proto}://${host}/api/rooms`;
      return new WebsocketProvider(url, room, d, {
        maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
        disableBc: true,
        resyncInterval: IDLE_KEEPALIVE_MS,
      }) as unknown as ProviderLike;
    });

  const provider = makeProvider('ws://placeholder/api/rooms', boardId, doc);
  const monitor = createConnectionMonitor(provider, onState, options.scheduler);
  return {
    provider,
    destroy() {
      monitor.destroy();
      provider.destroy();
    },
  };
}