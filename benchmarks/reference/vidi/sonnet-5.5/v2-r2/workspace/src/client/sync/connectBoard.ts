import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The slice of `WebsocketProvider` the status mapping depends on. */
export interface ProviderLike {
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  destroy(): void;
}

export type ProviderFactory = (doc: Y.Doc, boardId: string) => ProviderLike;

function wsOrigin(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

const defaultFactory: ProviderFactory = (doc, boardId) =>
  new WebsocketProvider(`${wsOrigin()}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  }) as unknown as ProviderLike;

/**
 * Attaches a y-websocket provider to `doc` and reports a user-facing connection state.
 * `createProvider` exists so tests can drive the mapping with a fake provider.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: ProviderFactory = defaultFactory,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let hasConnected = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  onState(state);
  const provider = createProvider(doc, boardId);

  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && hasConnected) {
      clearTimer();
      set('reconnecting');
    }
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    const wasReconnecting = state === 'reconnecting';
    hasConnected = true;
    if (wasReconnecting) {
      set('confirmed');
      clearTimer();
      timer = setTimeout(() => { timer = null; set('connected'); }, CONNECTED_CONFIRMATION_MS);
    } else if (state === 'connecting') {
      set('connected');
    }
  });

  return {
    destroy() {
      clearTimer();
      provider.destroy();
    },
  };
}
