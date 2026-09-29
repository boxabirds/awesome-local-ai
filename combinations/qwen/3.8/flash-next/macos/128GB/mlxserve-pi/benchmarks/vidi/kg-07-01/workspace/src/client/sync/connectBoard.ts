import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/**
 * - `connecting`: first connection not yet synced (the board is still editable locally).
 * - `connected`: synced; the badge is hidden.
 * - `reconnecting`: the connection was lost after having been connected.
 * - `confirmed`: synced again after `reconnecting`; shown for CONNECTED_CONFIRMATION_MS, then `connected`.
 * - `load_failed`: the server closed with CLOSE_BOARD_LOAD_FAILED (its saved board cannot be loaded); the
 *   provider keeps retrying and editing is disabled until a sync succeeds.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** The provider events the state mapping needs (lets tests drive it with a fake). */
export interface SyncProviderEvents {
  on(event: 'status', fn: (e: { status: 'connected' | 'disconnected' | 'connecting' }) => void): void;
  on(event: 'sync', fn: (synced: boolean) => void): void;
  /** `event` is null when the socket was closed locally. */
  on(event: 'connection-close', fn: (event: { code: number } | null) => void): void;
}

/**
 * Maps provider `status`/`sync` events to ConnectionState and reports every change to `onState`.
 * Returns a function that cancels the pending confirmation timer.
 */
export function trackConnectionState(
  provider: SyncProviderEvents,
  onState: (s: ConnectionState) => void,
): () => void {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const set = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  provider.on('sync', (synced) => {
    if (!synced) return;
    if (state === 'load_failed') {
      // The board loaded after all: editing comes back without a page reload.
      everSynced = true;
      clearTimer();
      set('connected');
      return;
    }
    if (!everSynced) {
      everSynced = true;
      set('connected');
      return;
    }
    if (state !== 'reconnecting') return;
    set('confirmed');
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      set('connected');
    }, CONNECTED_CONFIRMATION_MS);
  });
  provider.on('connection-close', (event) => {
    if (event === null) return;
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      clearTimer();
      set('load_failed');
    } else if (state === 'load_failed') {
      // Any other close (network, storage failure 1011) means the board itself may be readable again.
      set(everSynced ? 'reconnecting' : 'connecting');
    }
  });
  provider.on('status', ({ status }) => {
    if (status !== 'disconnected' || !everSynced || state === 'load_failed') return;
    clearTimer();
    set('reconnecting');
  });
  onState(state);
  return clearTimer;
}

/** WebSocket origin of this page: ws(s)://host. */
export function roomsUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/rooms`;
}

/**
 * Connects `doc` to the board's room and keeps it in sync until `destroy()`.
 * BroadcastChannel is off, so tabs in one browser sync only through the server.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const provider = new WebsocketProvider(roomsUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  const stop = trackConnectionState(provider, onState);
  // A silent network loss would only be noticed after y-websocket's 30 s no-message timeout. When the browser
  // knows it went offline, drop the socket now (badge shows Reconnecting…); when it is back, retry at once
  // instead of waiting out the backoff.
  const onOffline = () => provider.ws?.close();
  const onOnline = () => {
    if (provider.wsconnected) return;
    provider.disconnect();
    provider.connect();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  return {
    destroy() {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      stop();
      provider.destroy();
    },
  };
}
