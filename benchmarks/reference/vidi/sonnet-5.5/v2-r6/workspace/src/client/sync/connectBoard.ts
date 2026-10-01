import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The slice of WebsocketProvider this module uses; tests supply a fake. */
export interface ProviderLike {
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
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

  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && everSynced) {
      lost = true;
      clearTimer();
      set('reconnecting');
    }
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    everSynced = true;
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
