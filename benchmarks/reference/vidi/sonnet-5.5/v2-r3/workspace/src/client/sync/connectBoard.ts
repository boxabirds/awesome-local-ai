import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The slice of WebsocketProvider that the status mapping uses (lets tests supply a fake). */
export interface ProviderLike {
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  destroy(): void;
}

export type ProviderFactory = (doc: Y.Doc, boardId: string) => ProviderLike;

const defaultFactory: ProviderFactory = (doc, boardId) => {
  const wsOrigin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  return new WebsocketProvider(`${wsOrigin}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true, // tabs must not sync around the server
  });
};

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: ProviderFactory = defaultFactory,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let hasSynced = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const set = (next: ConnectionState) => {
    if (destroyed || next === state) return;
    state = next;
    onState(next);
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const provider = createProvider(doc, boardId);
  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && hasSynced) {
      clearTimer();
      set('reconnecting');
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
        if (state === 'confirmed') set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    } else if (state === 'connecting') {
      set('connected');
    }
  });

  return {
    destroy() {
      if (destroyed) return;
      clearTimer();
      destroyed = true;
      provider.destroy();
    },
  };
}
