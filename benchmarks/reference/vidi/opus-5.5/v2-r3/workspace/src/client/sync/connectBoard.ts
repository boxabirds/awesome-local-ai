// Connects a board's Y.Doc to its BoardRoom through the y-websocket provider and
// maps the provider's events to the four states the status badge shows.
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** The part of WebsocketProvider the state mapping listens to (fakeable in tests). */
export interface ProviderLike {
  on(event: 'status', handler: (e: { status: 'connected' | 'disconnected' | 'connecting' }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  /** `event` is null when the provider closed the socket itself. */
  on(event: 'connection-close', handler: (event: { code: number } | null) => void): void;
  destroy(): void;
}

export type CreateProvider = (doc: Y.Doc, boardId: string) => ProviderLike;

/** Room endpoint on the same origin as the page (ws:// or wss://). */
export function roomsUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/rooms`;
}

const createWebsocketProvider: CreateProvider = (doc, boardId) =>
  new WebsocketProvider(roomsUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Tabs in one browser must not sync around the server.
    disableBc: true,
  });

/**
 * connecting → connected on the first sync; a lost connection → reconnecting;
 * the next sync → confirmed for CONNECTED_CONFIRMATION_MS, then connected.
 * A close with CLOSE_BOARD_LOAD_FAILED → load_failed (the provider keeps
 * retrying) until a sync succeeds → connected. Every other close code, including
 * CLOSE_STORAGE_FAILURE, is an ordinary lost connection: the board stays
 * editable and unsaved changes are re-sent on reconnection.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  createProvider: CreateProvider = createWebsocketProvider,
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

  onState(state);
  const provider = createProvider(doc, boardId);
  provider.on('sync', (synced) => {
    if (!synced) return;
    if (state === 'load_failed') {
      set('connected');
    } else if (state === 'reconnecting') {
      set('confirmed');
      clearConfirm();
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    } else if (state === 'connecting') {
      set('connected');
    }
  });
  provider.on('connection-close', (event) => {
    if (event?.code === CLOSE_BOARD_LOAD_FAILED) {
      clearConfirm();
      set('load_failed');
    } else if (state !== 'connecting' && state !== 'load_failed') {
      clearConfirm();
      set('reconnecting');
    }
  });
  provider.on('status', ({ status }) => {
    // Before the first sync every failure just keeps "Connecting…"; a board that
    // could not be loaded keeps saying so while retrying.
    if (status === 'disconnected' && state !== 'connecting' && state !== 'load_failed') {
      clearConfirm();
      set('reconnecting');
    }
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearConfirm();
      provider.destroy();
    },
  };
}
