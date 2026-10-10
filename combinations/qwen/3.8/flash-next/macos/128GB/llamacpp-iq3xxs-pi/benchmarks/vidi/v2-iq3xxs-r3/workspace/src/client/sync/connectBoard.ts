/**
 * The browser side of sync (sync.client): one y-websocket provider per board
 * tab, and the four-state connection status the badge shows (live.status).
 *
 * The provider is created exactly as the design's contract says — same-origin
 * `ws(s)://<host>/api/rooms` plus the board id as the room name, exponential
 * backoff up to RECONNECT_MAX_BACKOFF_MS, and BroadcastChannel off so two tabs
 * of one browser cannot sync around the server (which would let tests pass
 * while the server path is broken).
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * What the badge knows about the connection. `connected` means "normal, nothing
 * to show"; `confirmed` is the green confirmation a recovered connection gets
 * for CONNECTED_CONFIRMATION_MS before the badge hides again.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** The three states y-websocket reports over the wire. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** Handle on one board's live connection. */
export interface BoardConnection {
  /** Detach from the document and close the connection (unmount, board change). */
  destroy(): void;
  /**
   * Close the socket as if the wire had been cut. Nothing else changes: the
   * board keeps working locally, the missed updates are exchanged on the next
   * connection, and the usual backoff retries the room (live.catch_up, TC-27).
   */
  drop(): void;
}

/** Everything the room shares lives under this path (see `src/worker/index.ts`). */
export const ROOM_PATH_PREFIX = '/api/rooms';

/**
 * `ws(s)://<current host>/api/rooms` — the provider appends `/<boardId>`. Same
 * origin as the page on purpose: the Worker that served the client is the Worker
 * that hosts the room, so no server address is ever configured.
 */
export function roomServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${ROOM_PATH_PREFIX}`;
}

/** The tracker's job: turn provider events into badge states. */
export interface ConnectionTracker {
  /** A `status` event from the provider. */
  status(status: ProviderStatus): void;
  /** A `sync` event from the provider (`false` when a connection is lost). */
  sync(synced: boolean): void;
  /** The state reported last. */
  readonly state: ConnectionState;
  /** Stop the confirmation timer. */
  destroy(): void;
}

/**
 * The state machine of the design's state diagram, kept separate from the
 * provider so the badge transitions are testable without a network:
 *
 * ```text
 * connecting --sync(true) first time--> connected
 * connecting --disconnected (never connected)--> connecting
 * connected  --disconnected--------> reconnecting
 * reconnecting --sync(true)--------> confirmed --CONFIRM_MS--> connected
 * confirmed  --disconnected--------> reconnecting
 * ```
 *
 * A connection that has not been established yet is `connecting`, forever if
 * need be — that is the first load of a board whose server is unreachable
 * (prd: the board still works locally).
 */
export function createConnectionTracker(
  onState: (state: ConnectionState) => void,
  confirmationMs: number = CONNECTED_CONFIRMATION_MS,
): ConnectionTracker {
  let current: ConnectionState = 'connecting';
  /** True from the first successful sync on; the badge distinguishes "first
   * load" from "recovered" by it. */
  let hasSynced = false;
  let confirmation: ReturnType<typeof setTimeout> | undefined;

  const set = (next: ConnectionState): void => {
    if (next === current) return;
    current = next;
    onState(next);
  };

  return {
    status(status: ProviderStatus): void {
      if (status === 'disconnected') {
        // Only a *lost* connection is worth a badge. A first connection that
        // never came up keeps saying "Connecting…" (live.status).
        if (hasSynced) {
          if (confirmation !== undefined) {
            clearTimeout(confirmation);
            confirmation = undefined;
          }
          set('reconnecting');
        }
        return;
      }
      // `connecting` and `connected` (socket open, not synced yet) never change
      // what the user already sees; `sync(true)` is the moment that counts.
    },

    sync(synced: boolean): void {
      if (!synced) return; // always followed by a `disconnected` status
      if (!hasSynced) {
        hasSynced = true;
        set('connected');
        return;
      }
      if (current === 'confirmed') return;
      set('confirmed');
      confirmation = setTimeout(() => {
        confirmation = undefined;
        set('connected');
      }, confirmationMs);
    },

    get state(): ConnectionState {
      return current;
    },

    destroy(): void {
      if (confirmation !== undefined) clearTimeout(confirmation);
      confirmation = undefined;
    },
  };
}

/**
 * Attach the live connection of one board to a document.
 *
 * Everything about the document stays local while the connection is down: the
 * provider queues what it cannot send, the room sends its SyncStep1 on the next
 * connection and both sides exchange what they missed (live.catch_up).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  const tracker = createConnectionTracker(onState);
  provider.on('status', (event: { status: ProviderStatus }) => tracker.status(event.status));
  provider.on('sync', (synced: boolean) => tracker.sync(synced));
  return {
    drop(): void {
      // The socket's own close event runs the provider's whole lost-connection
      // path, backoff included. `provider.disconnect()` would be the wrong
      // call: it means "we chose to be away" and does not come back on its own.
      provider.ws?.close();
    },
    destroy(): void {
      tracker.destroy();
      provider.destroy();
      // Not the provider's to free: awareness owns a timer of its own, and the
      // document it describes is gone with this tab. (Story 6 puts presence in
      // it; story 3 only carries the keepalive traffic it generates.)
      provider.awareness.destroy();
    },
  };
}
