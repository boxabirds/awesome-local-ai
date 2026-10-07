import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/**
 * What the user is told about this board connection (PRD conn.badge).
 *
 * - `connecting`  no board has been seen yet (first connection attempt)
 * - `connected`   in sync with the room; the badge renders nothing
 * - `reconnecting` a connection that had synced dropped, or a new attempt is
 *   under way after one had synced — the board is still editable
 * - `confirmed`   just re-synced after a reconnection; the badge says so for
 *   `CONNECTED_CONFIRMATION_MS` before it disappears again
 * - `load_failed` the room closed the connection with `CLOSE_BOARD_LOAD_FAILED`
 *   (4500): the saved board could not be read, so it is not shown and the board is
 *   not editable while the client keeps retrying (PRD persist.load_failure)
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Whether the board accepts edits in this connection state. Every state except
 * `load_failed` keeps the board editable — even `reconnecting`, where offline
 * changes are held in the document and sent on the next connection. `load_failed`
 * is the one state that locks the board, because there is no board on screen to
 * edit (it refused to load), and editing it would only produce changes that cannot
 * be saved (PRD persist.load_failure).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The part of `WebsocketProvider` this module uses, as an interface, so tests can
 * drive the state machine with a fake emitter instead of a socket (design
 * "Fixtures": the badge is covered by component tests with a fake provider).
 */
export interface ProviderLike {
  on(event: 'status', handler: (state: { status: string }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  on(
    event: 'connection-close',
    handler: (event: { code: number } | null, provider: unknown) => void,
  ): void;
  off(event: 'status', handler: (state: { status: string }) => void): void;
  off(event: 'sync', handler: (synced: boolean) => void): void;
  off(
    event: 'connection-close',
    handler: (event: { code: number } | null, provider: unknown) => void,
  ): void;
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
  let loadFailed = false;
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

  const onConnectionClose = (event: { code: number } | null): void => {
    // A close we asked for ourselves (event null) is not a message from the room.
    if (!event) return;
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      // The board could not be read: show the load-failure message and hold it up
      // while the provider keeps retrying (design: LoadFailed -> LoadFailed).
      clearConfirmation();
      loadFailed = true;
      publish('load_failed');
      return;
    }
    // Any other close code (1011 storage failure, 1003 rejected data, a network
    // drop) is a connection that has to be replaced, not a board that failed to
    // load — the board stays readable and editable (design TC-28).
    loadFailed = false;
    clearConfirmation();
    if (everSynced) publish('reconnecting');
  };

  const onStatus = ({ status }: { status: string }): void => {
    if (loadFailed) return; // the load-failure message stays while it is retried
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
      if (loadFailed) return; // still failing to load: keep the load-failure message
      clearConfirmation();
      if (everSynced) publish('reconnecting');
      return;
    }
    // A successful sync means the board loaded and connected: whatever failure the
    // badge was reporting (including a load failure that has now recovered) is over.
    loadFailed = false;
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
  provider.on('connection-close', onConnectionClose);

  return {
    provider,
    state: () => current,
    dropConnection: () => provider.disconnect?.(),
    resumeConnection: () => provider.connect?.(),
    destroy: () => {
      clearConfirmation();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('connection-close', onConnectionClose);
      try {
        provider.disconnect?.();
        provider.destroy();
      } catch {
        // a socket that is already gone has nowhere left to disconnect to
      }
    },
  };
}
