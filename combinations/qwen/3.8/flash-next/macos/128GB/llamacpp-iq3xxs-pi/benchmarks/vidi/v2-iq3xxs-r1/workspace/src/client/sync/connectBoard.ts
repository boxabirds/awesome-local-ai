import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';

/**
 * What the user is told about this board connection (PRD conn.badge).
 *
 * - `connecting`  no board has been seen yet (first connection attempt)
 * - `connected`   in sync with the room; the badge renders nothing
 * - `reconnecting` a connection that had synced dropped, or a new attempt is
 *   under way after one had synced — the board is still editable
 * - `confirmed`   just re-synced after a reconnection; the badge says so for
 *   `CONNECTED_CONFIRMATION_MS` before it disappears again
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * The part of `WebsocketProvider` this module uses, as an interface, so tests can
 * drive the state machine with a fake emitter instead of a socket (design
 * "Fixtures": the badge is covered by component tests with a fake provider).
 */
export interface ProviderLike {
  on(event: 'status', handler: (state: { status: string }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  off(event: 'status', handler: (state: { status: string }) => void): void;
  off(event: 'sync', handler: (synced: boolean) => void): void;
  destroy(): void;
  disconnect?(): void;
  connect?(): void;
}

export interface ConnectOptions {
  /** Injected in tests; production builds the real `WebsocketProvider`. */
  provider?: ProviderLike;
  /** Where the room websocket lives; overridable for tests. */
  serverUrl?: string;
  /** How long the green confirmation badge stays up. */
  confirmationMs?: number;
  /** Timer injection for tests that need it. */
  after?: (ms: number, run: () => void) => () => void;
}

export interface BoardConnection {
  readonly provider: ProviderLike;
  /** The state the last event produced (also reported to `onState`). */
  state(): ConnectionState;
  /**
   * Close the socket without leaving the board — what a network cut looks like
   * from here. Used by the browser tests: `page.context().setOffline(true)` does
   * not close an already-open socket, so it cannot stand in for a dropped
   * connection.
   */
  dropConnection(): void;
  /** Ask the provider to reconnect after a manual drop. */
  resumeConnection(): void;
  /** Leave the board: close the socket, stop reconnecting, drop listeners. */
  destroy(): void;
}

/** `ws://` on http, `wss://` on https; the room path is added by the provider. */
export function roomServerUrl(): string {
  const scheme = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
  const host = typeof location !== 'undefined' ? location.host : 'localhost';
  return `${scheme}://${host}/api/rooms`;
}

/**
 * Attach `doc` to its board room and translate the provider's low-level events
 * into the four `ConnectionState` values the badge knows.
 *
 * `y-websocket` reconnects on its own with an exponential backoff capped at
 * `RECONNECT_MAX_BACKOFF_MS`; nothing here re-implements that, and nothing here
 * would refuse a 6th participant (PRD live.over_capacity). BroadcastChannel is
 * switched off: two tabs of the *same* browser must not sync around the server,
 * or the room would not be the thing under test (design "Two browser contexts").
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectOptions = {},
): BoardConnection {
  const provider =
    options.provider ??
    (new WebsocketProvider(options.serverUrl ?? roomServerUrl(), boardId, doc, {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
    }) as unknown as ProviderLike);

  const confirmationMs = options.confirmationMs ?? CONNECTED_CONFIRMATION_MS;
  const schedule =
    options.after ??
    ((ms: number, run: () => void) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    });

  let current: ConnectionState = 'connecting';
  let everSynced = false;
  let cancelConfirmation: (() => void) | null = null;

  const publish = (next: ConnectionState): void => {
    if (next === current) return;
    current = next;
    onState(next);
  };
  const clearConfirmation = (): void => {
    if (cancelConfirmation) {
      cancelConfirmation();
      cancelConfirmation = null;
    }
  };

  const onStatus = ({ status }: { status: string }): void => {
    if (status === 'disconnected') {
      // A connection that had synced went away: the board is now local-only
      // (PRD conn.badge), and edits made while offline stay in the document.
      clearConfirmation();
      if (everSynced) publish('reconnecting');
      return;
    }
    if (status === 'connecting' && everSynced) {
      // Retrying after a drop: keep saying "Reconnecting…" rather than flashing
      // the first-run wording again.
      clearConfirmation();
      publish('reconnecting');
    }
  };

  const onSync = (synced: boolean): void => {
    if (!synced) {
      clearConfirmation();
      if (everSynced) publish('reconnecting');
      return;
    }
    if (!everSynced) {
      // The first sync of a fresh page: the board is live, no badge needed.
      everSynced = true;
      publish('connected');
      return;
    }
    // Re-synced after a reconnection: confirm it, then get out of the way.
    clearConfirmation();
    publish('confirmed');
    cancelConfirmation = schedule(confirmationMs, () => {
      cancelConfirmation = null;
      publish('connected');
    });
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  return {
    provider,
    state: () => current,
    dropConnection: () => provider.disconnect?.(),
    resumeConnection: () => provider.connect?.(),
    destroy: () => {
      clearConfirmation();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      try {
        provider.disconnect?.();
        provider.destroy();
      } catch {
        // a socket that is already gone has nowhere left to disconnect to
      }
    },
  };
}
