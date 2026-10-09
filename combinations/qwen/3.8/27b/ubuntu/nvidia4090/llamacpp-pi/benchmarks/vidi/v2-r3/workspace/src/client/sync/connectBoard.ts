import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** Minimal duck type of the parts of WebsocketProvider the app relies on. */
export interface ProviderLike {
  on(event: 'status', handler: (e: { status: ProviderStatus }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  destroy(): void;
}

/**
 * Maps provider status/sync events to the app's connection state:
 *
 * - provider `connecting` before first sync -> `connecting` ("Connecting…")
 * - first `sync(true)` -> `connected` (badge hidden)
 * - `disconnected` after having synced -> `reconnecting` ("Reconnecting…")
 * - re-sync after reconnect -> `confirmed` ("Connected") for
 *   CONNECTED_CONFIRMATION_MS, then `connected`
 * - a disconnect during the confirmation goes straight back to
 *   `reconnecting`
 */
export interface StateMapper {
  onStatus(status: ProviderStatus): void;
  onSync(synced: boolean): void;
  dispose(): void;
}

export function createConnectionState(onState: (s: ConnectionState) => void): StateMapper {
  let state: ConnectionState = 'connecting';
  let hasEverSynced = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (s: ConnectionState) => {
    if (s !== state) {
      state = s;
      onState(s);
    }
  };
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  onState('connecting');

  return {
    onStatus(status) {
      if (status === 'connecting') {
        if (hasEverSynced) set('reconnecting');
        else set('connecting');
      } else if (status === 'disconnected') {
        if (hasEverSynced) {
          clearTimer();
          set('reconnecting');
        }
        // never synced: still on the first load, keep "Connecting…"
      }
      // 'connected' waits for sync before the badge changes
    },
    onSync(synced) {
      if (!synced) return;
      if (!hasEverSynced) {
        hasEverSynced = true;
        set('connected');
      } else if (state === 'reconnecting') {
        set('confirmed');
        clearTimer();
        timer = setTimeout(() => {
          timer = null;
          set('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    },
    dispose() {
      clearTimer();
    },
  };
}

export interface BoardConnection {
  destroy(): void;
}

export function wsOrigin(): string {
  const proto =
    typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof location !== 'undefined' ? location.host : 'localhost';
  return `${proto}://${host}`;
}

/**
 * Attaches a y-websocket provider to the board document for /api/rooms/:boardId.
 * The board stays fully editable while disconnected; the provider retries with
 * backoff up to RECONNECT_MAX_BACKOFF_MS.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
  opts?: { providerFactory?: () => ProviderLike },
): BoardConnection {
  const provider = opts?.providerFactory
    ? opts.providerFactory()
    : new WebsocketProvider(`${wsOrigin()}/api/rooms`, boardId, doc, {
        maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
        disableBc: true,
      });
  const mapper = createConnectionState(onState);
  provider.on('status', (e) => mapper.onStatus(e.status));
  provider.on('sync', (synced) => mapper.onSync(synced));
  return {
    destroy() {
      mapper.dispose();
      provider.destroy();
    },
  };
}
