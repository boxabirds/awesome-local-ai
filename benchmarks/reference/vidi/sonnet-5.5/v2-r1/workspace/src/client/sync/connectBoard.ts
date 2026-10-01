import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** The slice of `WebsocketProvider` the status mapping depends on (lets tests drive it with a fake). */
export interface ProviderLike {
  on(event: 'connection-close', cb: (e: { code: number } | null) => void): void;
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  destroy(): void;
}

function defaultProvider(doc: Y.Doc, boardId: string): ProviderLike {
  const origin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  return new WebsocketProvider(`${origin}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true, // tabs must sync through the server, never around it
  });
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: (doc: Y.Doc, boardId: string) => ProviderLike = defaultProvider,
): { destroy(): void } {
  const provider = createProvider(doc, boardId);
  let state: ConnectionState = 'connecting';
  let hasSynced = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  onState(state);

  provider.on('connection-close', (e) => {
    if (e?.code === CLOSE_BOARD_LOAD_FAILED) {
      clearTimer();
      set('load_failed');
    } else if (state === 'load_failed' || (hasSynced && state !== 'reconnecting')) {
      // Any other close (1011 storage failure, 1003, network): the board is readable, changes are re-sent.
      clearTimer();
      set(hasSynced ? 'reconnecting' : 'connecting');
    }
  });

  provider.on('sync', (synced) => {
    if (!synced) return;
    const wasReconnecting = state === 'reconnecting';
    hasSynced = true;
    if (wasReconnecting) {
      set('confirmed');
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    } else if (state === 'connecting' || state === 'load_failed') {
      set('connected');
    }
  });

  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && hasSynced && state !== 'load_failed') {
      clearTimer();
      set('reconnecting');
    }
  });

  return {
    destroy() {
      clearTimer();
      provider.destroy();
    },
  };
}
