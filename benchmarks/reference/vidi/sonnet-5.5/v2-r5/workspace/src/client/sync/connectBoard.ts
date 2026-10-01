import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** The slice of WebsocketProvider that connectBoard relies on (lets tests inject a fake). */
export interface ProviderLike {
  on(event: 'status', cb: (e: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  on(event: 'sync', cb: (synced: boolean) => void): void;
  on(event: 'connection-close', cb: (e: { code: number } | null) => void): void;
  destroy(): void;
}

export type ProviderFactory = (url: string, boardId: string, doc: Y.Doc) => ProviderLike;

function wsOrigin(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

const defaultFactory: ProviderFactory = (url, boardId, doc) =>
  new WebsocketProvider(url, boardId, doc, { maxBackoffTime: RECONNECT_MAX_BACKOFF_MS, disableBc: true });

export function connectBoard(
  doc: Y.Doc, boardId: string, onState: (s: ConnectionState) => void, factory: ProviderFactory = defaultFactory,
): { destroy(): void } {
  const provider = factory(`${wsOrigin()}/api/rooms`, boardId, doc);
  let state: ConnectionState = 'connecting';
  let everConnected = false;
  let lost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const clearTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };

  onState(state);
  provider.on('connection-close', (e) => {
    const code = typeof e?.code === 'number' ? e.code : undefined;
    if (code === undefined) return;
    clearTimer();
    if (code === CLOSE_BOARD_LOAD_FAILED) {
      set('load_failed');
    } else if (state !== 'load_failed') {
      // Storage failure (1011), 1003 and network closes: the board is readable and changes are re-sent.
      if (everConnected) lost = true;
      set('reconnecting');
    }
  });
  provider.on('status', ({ status }) => {
    if (status !== 'disconnected') return;
    clearTimer();
    if (state === 'load_failed') return; // keep the honest message while the provider retries
    if (everConnected) {
      lost = true;
      set('reconnecting');
    }
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    clearTimer();
    if (state === 'load_failed') lost = false; // first successful load: no "Connected" confirmation
    everConnected = true;
    if (lost) {
      lost = false;
      set('confirmed');
      timer = setTimeout(() => { timer = undefined; set('connected'); }, CONNECTED_CONFIRMATION_MS);
    } else {
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
