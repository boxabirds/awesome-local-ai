import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The subset of WebsocketProvider this module relies on (lets tests drive it with a fake). */
export interface ProviderLike {
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  destroy(): void;
}

export type ProviderFactory = (doc: Y.Doc, boardId: string) => ProviderLike;

function wsOrigin(): string {
  return location.origin.replace(/^http/, 'ws');
}

const defaultFactory: ProviderFactory = (doc, boardId) => {
  const provider = new WebsocketProvider(`${wsOrigin()}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true, // same-browser tabs must not sync around the server
  });
  // A browser that knows it is offline may keep a dead socket "open" for a long time; drop it so the
  // badge reflects reality at once, and retry immediately when the network returns.
  const onOffline = () => {
    provider.ws?.close();
    provider.emit('status', [{ status: 'disconnected' }]); // a dead socket only reports its close much later
  };
  const onOnline = () => {
    if (!provider.wsconnected) provider.ws?.close();
    provider.connect();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  const destroy = provider.destroy.bind(provider);
  provider.destroy = () => {
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    destroy();
  };
  return provider as unknown as ProviderLike;
};

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: ProviderFactory = defaultFactory,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let lost = false; // connection dropped after having been established
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const set = (s: ConnectionState) => {
    if (destroyed || s === state) return;
    state = s;
    onState(s);
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const provider = createProvider(doc, boardId);
  provider.on('status', ({ status }) => {
    if (status === 'disconnected' && (state !== 'connecting' || lost)) {
      lost = true;
      clearTimer();
      set('reconnecting');
    }
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    clearTimer();
    if (lost) {
      lost = false;
      set('confirmed');
      timer = setTimeout(() => {
        timer = null;
        set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    } else {
      set('connected');
    }
  });

  onState(state);
  return {
    destroy() {
      destroyed = true;
      clearTimer();
      provider.destroy();
    },
  };
}
