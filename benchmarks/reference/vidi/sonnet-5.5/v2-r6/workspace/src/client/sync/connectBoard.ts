import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** The slice of WebsocketProvider this module uses; tests supply a fake. */
export interface ProviderLike {
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  on(event: 'connection-close', cb: (e: { code: number } | null) => void): void;
  destroy(): void;
}

export type ProviderFactory = (doc: Y.Doc, boardId: string) => ProviderLike;

function wsOrigin(): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
}

const defaultFactory: ProviderFactory = (doc, boardId) => new WebsocketProvider(
  `${wsOrigin()}/api/rooms`, boardId, doc,
  // BroadcastChannel off so tabs of one browser cannot sync around the server.
  { maxBackoffTime: RECONNECT_MAX_BACKOFF_MS, disableBc: true },
);

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: ProviderFactory = defaultFactory,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let lost = false;
  let loadFailed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const set = (s: ConnectionState) => {
    if (destroyed || s === state) return;
    state = s;
    onState(s);
  };
  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  onState(state);
  const provider = createProvider(doc, boardId);

  provider.on('connection-close', (event) => {
    if (event?.code !== CLOSE_BOARD_LOAD_FAILED) return;
    loadFailed = true;
    clearTimer();
    set('load_failed');
  });
  provider.on('status', ({ status }) => {
    if (loadFailed) return; // stays on the load-failed message until a sync succeeds
    if (status === 'disconnected' && everSynced) {
      lost = true;
      clearTimer();
      set('reconnecting');
    }
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    everSynced = true;
    if (loadFailed) { loadFailed = false; lost = false; set('connected'); return; }
    if (!lost) { set('connected'); return; }
    lost = false;
    clearTimer();
    set('confirmed');
    timer = setTimeout(() => { timer = null; set('connected'); }, CONNECTED_CONFIRMATION_MS);
  });

  return {
    destroy() {
      destroyed = true;
      clearTimer();
      provider.destroy();
    },
  };
}
