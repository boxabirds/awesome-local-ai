import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * `connecting`: first load, not yet synced. `connected`: synced (badge hidden).
 * `reconnecting`: lost after having connected. `confirmed`: synced again after reconnecting,
 * for CONNECTED_CONFIRMATION_MS, then `connected`.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The provider events the state mapping listens to (a WebsocketProvider, or a fake in tests). */
export interface ProviderEvents {
  on(event: 'status', listener: (e: { status: string }) => void): void;
  on(event: 'sync', listener: (synced: boolean) => void): void;
  off(event: 'status', listener: (e: { status: string }) => void): void;
  off(event: 'sync', listener: (synced: boolean) => void): void;
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
    if (!everSynced) return; // still the first load: stays `connecting`
    clearConfirm();
    set('reconnecting');
  };
  const onSync = (synced: boolean) => {
    if (!synced) {
      lost();
      return;
    }
    if (!everSynced) {
      everSynced = true;
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

  onState(state);
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  return () => {
    clearConfirm();
    provider.off('status', onStatus);
    provider.off('sync', onSync);
  };
}

function roomsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/rooms`;
}

/**
 * Connects `doc` to the board's live room and keeps it connected (reconnecting with backoff up
 * to RECONNECT_MAX_BACKOFF_MS). The board stays editable in every state: edits go into the
 * local doc and are sent once connected.
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
