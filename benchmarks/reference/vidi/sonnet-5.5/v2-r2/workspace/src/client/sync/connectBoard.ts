import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** The slice of `WebsocketProvider` the status mapping depends on. */
export interface ProviderLike {
  on(event: 'connection-close', cb: (e: { code: number } | null) => void): void;
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

  provider.on('connection-close', (event) => {
    if (event?.code === CLOSE_BOARD_LOAD_FAILED) {
      clearTimer();
      set('load_failed');
    } else if (hasConnected || state === 'load_failed') {
      // Storage failure (1011), bad data (1003) or network loss: the board is readable and
      // unsaved changes are re-sent on reconnection.
      clearTimer();
      set('reconnecting');
    }
  });
  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && hasConnected && state !== 'load_failed') {
      clearTimer();
      set('reconnecting');
    }
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    const wasReconnecting = state === 'reconnecting';
    const wasLoadFailed = state === 'load_failed';
    hasConnected = true;
    if (wasLoadFailed) {
      set('connected');
    } else if (wasReconnecting) {
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
