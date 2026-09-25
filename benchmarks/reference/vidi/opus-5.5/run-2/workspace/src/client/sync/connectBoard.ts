/**
 * Connects a board's Y.Doc to its BoardRoom (anchor: sync.client) and maps the
 * y-websocket provider's `status` / `sync` events to the badge's ConnectionState:
 *
 *   connecting ──sync──▶ connected ──disconnected──▶ reconnecting ──sync──▶ confirmed
 *                                   ▲                                          │
 *                                   └──────── CONNECTED_CONFIRMATION_MS ───────┘
 *
 * The board stays editable in every state; edits made while disconnected stay in the
 * Y.Doc and are exchanged by the sync handshake on reconnection.
 */
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { recordConnectionState } from '../canvas/testHooks';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export const ROOMS_PATH = '/api/rooms';

/** The subset of WebsocketProvider that connectBoard relies on (fakeable in tests). */
export interface SyncProvider {
  on(event: 'status', handler: (event: { status: 'connected' | 'disconnected' | 'connecting' }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
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
  provider.on('status', ({ status }) => {
    if (status !== 'disconnected') return; // "connected" only counts once synced
    clearConfirm();
    set(hasSynced ? 'reconnecting' : 'connecting');
  });
  provider.on('sync', (synced) => {
    if (!synced) return;
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
