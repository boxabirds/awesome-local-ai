import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/**
 * `connecting`: first load, not yet synced. `connected`: synced (badge hidden).
 * `reconnecting`: lost after having connected. `confirmed`: synced again after reconnecting,
 * for CONNECTED_CONFIRMATION_MS, then `connected`. `load_failed`: the room closed with
 * CLOSE_BOARD_LOAD_FAILED (its saved board cannot be loaded); retrying until a sync succeeds.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** The provider events the state mapping listens to (a WebsocketProvider, or a fake in tests). */
export interface ProviderEvents {
  on(event: 'status', listener: (e: { status: string }) => void): void;
  on(event: 'sync', listener: (synced: boolean) => void): void;
  on(event: 'connection-close', listener: (e: { code: number } | null) => void): void;
  off(event: 'status', listener: (e: { status: string }) => void): void;
  off(event: 'sync', listener: (synced: boolean) => void): void;
  off(event: 'connection-close', listener: (e: { code: number } | null) => void): void;
}

/**
 * Maps provider `status` and `sync` events to a ConnectionState, reporting every change to
 * `onState` (starting with `connecting`). Returns a function that stops tracking.
 */
export function trackConnectionState(
  provider: ProviderEvents,
  onState: (s: ConnectionState) => void,
): () => void {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const clearConfirm = () => {
    if (confirmTimer !== null) clearTimeout(confirmTimer);
    confirmTimer = null;
  };
  const lost = () => {
    // Still the first load: stays `connecting`. A board that cannot be loaded stays so until
    // a sync succeeds, whatever ends the next attempts.
    if (!everSynced || state === 'load_failed') return;
    clearConfirm();
    set('reconnecting');
  };
  const onSync = (synced: boolean) => {
    if (!synced) {
      lost();
      return;
    }
    if (!everSynced || state === 'load_failed') {
      everSynced = true;
      clearConfirm();
      set('connected');
      return;
    }
    if (state !== 'reconnecting') return;
    set('confirmed');
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      set('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };
  const onStatus = ({ status }: { status: string }) => {
    if (status === 'disconnected') lost();
  };
  // Emitted before the `disconnected` status. Other codes (e.g. 1011 storage failure, 1003)
  // mean the board is readable: they are ordinary reconnections.
  const onClose = (e: { code: number } | null) => {
    if (e?.code !== CLOSE_BOARD_LOAD_FAILED) return;
    clearConfirm();
    set('load_failed');
  };

  onState(state);
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('connection-close', onClose);
  return () => {
    clearConfirm();
    provider.off('status', onStatus);
    provider.off('sync', onSync);
    provider.off('connection-close', onClose);
  };
}

function roomsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/rooms`;
}

/**
 * Connects `doc` to the board's live room and keeps it connected (reconnecting with backoff up
 * to RECONNECT_MAX_BACKOFF_MS). The board stays editable in every state except `load_failed`
 * (see `canEdit`): edits go into the local doc and are sent once connected.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const provider = new WebsocketProvider(roomsUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Otherwise same-browser tabs would sync around the server.
    disableBc: true,
  });
  const stop = trackConnectionState(provider, onState);

  // Start over with a fresh socket (the provider then retries with backoff until it succeeds).
  const restart = () => {
    provider.disconnect();
    provider.connect();
  };
  // The browser knows the network is gone: drop the socket now instead of waiting for the
  // provider's no-message timeout. Once it is back, retry now instead of after the backoff.
  const onOffline = restart;
  const onOnline = () => {
    if (!provider.wsconnected) restart();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  return {
    destroy() {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      stop();
      provider.destroy();
      // The provider created this awareness instance; its renewal timer would outlive it.
      provider.awareness.destroy();
    },
  };
}
