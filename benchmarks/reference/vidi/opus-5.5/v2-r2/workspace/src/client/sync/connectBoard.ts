import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** The provider events the state mapping needs (a fake emitter in component tests). */
export interface ProviderEvents {
  on(event: 'status', handler: (e: { status: ProviderStatus }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  off(event: 'status', handler: (e: { status: ProviderStatus }) => void): void;
  off(event: 'sync', handler: (synced: boolean) => void): void;
}

/**
 * Maps provider `status` / `sync` events to the badge state:
 * `connecting` until the first sync → `connected`; a disconnect after that →
 * `reconnecting`; the next sync → `confirmed` for CONNECTED_CONFIRMATION_MS → `connected`.
 */
export function trackConnectionState(
  provider: ProviderEvents,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  let state: ConnectionState = 'connecting';
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
  const onStatus = ({ status }: { status: ProviderStatus }) => {
    if (status !== 'disconnected' || state === 'connecting') return;
    clearTimer();
    set('reconnecting');
  };
  const onSync = (synced: boolean) => {
    if (!synced) return;
    if (state === 'connecting') set('connected');
    else if (state === 'reconnecting') {
      set('confirmed');
      timer = setTimeout(() => {
        timer = null;
        set('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
  };
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  onState(state);
  return {
    destroy() {
      clearTimer();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
    },
  };
}

function roomsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/rooms`;
}

/**
 * Connects `doc` to the board's live room. Edits keep going into the local doc
 * in every state; the provider retries with backoff and re-syncs on reconnect.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  // BroadcastChannel off: same-browser tabs must sync through the server, never around it.
  const provider = new WebsocketProvider(roomsUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  const tracker = trackConnectionState(provider, onState);
  // The browser knows about a lost network before the socket times out: drop the
  // socket at once so the badge shows, and retry straight away when it returns.
  const restart = () => {
    provider.disconnect();
    provider.connect();
  };
  const onOffline = () => {
    if (provider.ws !== null) restart();
  };
  const onOnline = () => {
    if (!provider.wsconnected) restart();
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  return {
    destroy() {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      tracker.destroy();
      provider.destroy();
    },
  };
}
