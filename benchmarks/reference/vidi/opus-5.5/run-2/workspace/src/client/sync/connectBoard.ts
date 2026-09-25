/**
 * Connects a board's Y.Doc to its BoardRoom (anchor: sync.client) and maps the
 * y-websocket provider's `status` / `sync` events to the badge's ConnectionState:
 *
 *   connecting ──sync──▶ connected ──disconnected──▶ reconnecting ──sync──▶ confirmed
 *                                   ▲                                          │
 *                                   └──────── CONNECTED_CONFIRMATION_MS ───────┘
 *
 * A socket closed with CLOSE_BOARD_LOAD_FAILED (story 4) switches to `load_failed` from any
 * state; it stays there, through further failed attempts, until a sync succeeds, which
 * switches to `connected`. The provider keeps retrying with its usual backoff.
 * CLOSE_STORAGE_FAILURE and every other close code are ordinary disconnections.
 *
 * The board is editable in every state except `load_failed`; edits made while
 * disconnected stay in the Y.Doc and are exchanged by the sync handshake on reconnection.
 */
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { recordConnectionState } from '../canvas/testHooks';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

export const ROOMS_PATH = '/api/rooms';

/** The subset of WebsocketProvider that connectBoard relies on (fakeable in tests). */
export interface SyncProvider {
  on(event: 'status', handler: (event: { status: 'connected' | 'disconnected' | 'connecting' }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  /** Emitted before `status: disconnected`; `event` is null when the provider closed the socket itself. */
  on(event: 'connection-close', handler: (event: { code: number } | null) => void): void;
  destroy(): void;
}

export type ProviderFactory = (serverUrl: string, boardId: string, doc: Y.Doc) => SyncProvider;

const websocketProvider: ProviderFactory = (serverUrl, boardId, doc) =>
  new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Tabs in one browser must sync through the server, never around it.
    disableBc: true,
  });

function roomsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${ROOMS_PATH}`;
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: ProviderFactory = websocketProvider,
): { destroy(): void } {
  let state: ConnectionState | null = null;
  let hasSynced = false;
  let loadFailed = false;
  let destroyed = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: ConnectionState) => {
    if (destroyed || next === state) return;
    state = next;
    if (import.meta.env.MODE === 'test') recordConnectionState(next);
    onState(next);
  };
  const clearConfirm = () => {
    if (confirmTimer !== null) clearTimeout(confirmTimer);
    confirmTimer = null;
  };

  set('connecting');
  const provider = createProvider(roomsUrl(), boardId, doc);
  provider.on('connection-close', (event) => {
    if (event?.code !== CLOSE_BOARD_LOAD_FAILED) return;
    loadFailed = true;
    clearConfirm();
    set('load_failed');
  });
  provider.on('status', ({ status }) => {
    if (status !== 'disconnected') return; // "connected" only counts once synced
    if (loadFailed) return; // still not loaded: keep saying so until a sync succeeds
    clearConfirm();
    set(hasSynced ? 'reconnecting' : 'connecting');
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
    if (loadFailed) {
      loadFailed = false;
      hasSynced = true;
      set('connected');
      return;
    }
    const wasReconnecting = state === 'reconnecting';
    hasSynced = true;
    if (!wasReconnecting) {
      if (state !== 'confirmed') set('connected');
      return;
    }
    set('confirmed');
    clearConfirm();
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      set('connected');
    }, CONNECTED_CONFIRMATION_MS);
  });

  return {
    destroy() {
      clearConfirm();
      destroyed = true;
      provider.destroy();
    },
  };
}
