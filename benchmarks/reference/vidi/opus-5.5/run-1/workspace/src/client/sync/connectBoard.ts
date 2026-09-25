/**
 * Connects a board document to its room: one y-websocket provider per page, and the mapping
 * from provider events to the connection states the status badge shows.
 *
 *   connecting  — before the first successful sync (the board is editable locally)
 *   connected   — synced; badge hidden
 *   reconnecting — the connection was lost after having been connected (edits stay local)
 *   confirmed   — synced again after reconnecting; shown for CONNECTED_CONFIRMATION_MS
 *   load_failed — the room closed with CLOSE_BOARD_LOAD_FAILED: its saved board cannot be
 *                 loaded. Editing is disabled; the provider keeps retrying with its backoff and
 *                 the first successful sync goes to `connected` (story 4).
 *
 * A close with CLOSE_STORAGE_FAILURE (1011) is an ordinary lost connection (`reconnecting`):
 * the board is readable and unsaved changes are re-sent when the connection is re-established.
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

export const ROOMS_PATH = '/api/rooms';

type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** The part of WebsocketProvider this module uses (component tests pass a fake emitter). */
export interface BoardProvider {
  on(event: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  /** `event` is null when the provider closed the socket itself. */
  on(event: 'connection-close', handler: (event: { code: number } | null) => void): void;
  /** True while the socket is open. */
  readonly wsconnected: boolean;
  connect(): void;
  disconnect(): void;
  destroy(): void;
}

export type ProviderFactory = (doc: Y.Doc, boardId: string) => BoardProvider;

/** ws(s)://<this host>/api/rooms — the provider appends `/<boardId>`. */
export function roomsUrl(location: Location = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${ROOMS_PATH}`;
}

const createWebsocketProvider: ProviderFactory = (doc, boardId) =>
  new WebsocketProvider(roomsUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Otherwise tabs in one browser sync without the server, hiding a broken server path.
    disableBc: true,
  }) as unknown as BoardProvider;

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: ProviderFactory = createWebsocketProvider,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const set = (next: ConnectionState) => {
    if (destroyed || next === state) return;
    state = next;
    onState(next);
  };
  const clearConfirm = () => {
    if (confirmTimer !== null) clearTimeout(confirmTimer);
    confirmTimer = null;
  };

  const provider = createProvider(doc, boardId);

  provider.on('sync', (synced) => {
    if (!synced) return;
    if (state === 'connecting' || state === 'load_failed') {
      set('connected');
    } else if (state === 'reconnecting') {
      set('confirmed');
      clearConfirm();
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  });

  provider.on('connection-close', (event) => {
    if (event?.code === CLOSE_BOARD_LOAD_FAILED) {
      clearConfirm();
      set('load_failed');
    }
  });

  provider.on('status', ({ status }) => {
    if (status === 'connected') return; // "connected" means synced, which the sync event reports.
    // Lost after having synced: reconnecting. Before the first sync it stays "connecting".
    if (state === 'connected' || state === 'confirmed') {
      clearConfirm();
      set('reconnecting');
    }
  });

  // The browser knows about a lost network before the socket does (an idle socket can take
  // until y-websocket's no-message timeout to notice). Offline: drop the socket now so the
  // badge says so, and keep retrying with backoff. Online: retry immediately.
  const restart = () => {
    provider.disconnect();
    provider.connect();
  };
  const onOffline = () => restart();
  const onOnline = () => {
    if (!provider.wsconnected) restart();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  onState(state);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearConfirm();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      provider.destroy();
    },
  };
}
