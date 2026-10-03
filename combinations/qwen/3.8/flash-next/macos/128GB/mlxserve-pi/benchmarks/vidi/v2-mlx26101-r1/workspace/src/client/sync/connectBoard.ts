// The browser side of live collaboration: attach the board document to its room
// and translate the provider's connection events into the four states the badge
// renders. See the sync.client contract.
//
// The provider talks to `<this origin>/api/rooms/<boardId>` — the Worker route
// that hands the socket to that board's BoardRoom. Cross-tab BroadcastChannel is
// switched off on purpose: two tabs of the same browser must sync through the
// room like anybody else, otherwise a test (and a real second window) could see
// changes that never went anywhere.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/**
 * What the connection currently is, as shown by `ConnectionStatus`:
 * first load, in sync, lost while edits keep working, freshly back and
 * confirming before the badge hides — or `load_failed`, where the room could not
 * load the board at all. Only `load_failed` locks editing: the board on disk is
 * unreadable, so showing an empty board and letting someone type into it would
 * pretend the board was gone. Every other state leaves the board fully editable.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Whether the board may be edited in a given connection state. False only for
 * `load_failed`: the board itself is intact and editable in every other state,
 * including a retryable storage failure (1011), where unsaved changes are simply
 * re-sent on the next connection.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** A connection you can hand back to React's cleanup. */
export interface BoardConnection {
  destroy(): void;
}

/** The provider's own connection events, in the order they arrive. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * The state machine behind `connectBoard`, split out so the badge's timing is
 * testable with fake timers and a plain event emitter instead of a real provider.
 * It starts in `connecting` (the first load) and is driven by the provider events
 * `status`, `sync` and `connection-close`.
 */
export interface ConnectionTracker {
  /** The state the badge should show right now. */
  readonly state: ConnectionState;
  status(status: ProviderStatus): void;
  sync(synced: boolean): void;
  /** A socket closed. Only CLOSE_BOARD_LOAD_FAILED reads as an unloadable board. */
  close(code: number): void;
  /** Stop any pending "Connected" confirmation. */
  destroy(): void;
}

/** `/api/rooms` on this page's own origin, as a WebSocket URL. */
function roomServerUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/rooms`;
}

export function createConnectionTracker(
  onState: (state: ConnectionState) => void,
): ConnectionTracker {
  let state: ConnectionState = 'connecting';
  /** True from the first successful sync onwards: outages now read as "Reconnecting…". */
  let everSynced = false;
  /** Set while the green "Connected" badge is being shown. */
  let confirming = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /**
   * Set while the board could not be loaded. It holds the badge on `load_failed`
   * across the provider's reconnect attempts (which would otherwise flicker through
   * "Reconnecting…") until a sync finally lands and clears it. Distinct from the
   * retryable storage failure (1011), which never sets this.
   */
  let loadFailed = false;

  const publish = (next: ConnectionState): void => {
    if (destroyed || next === state) return;
    state = next;
    onState(next);
  };

  const stopConfirmation = (): void => {
    if (confirmation !== null) clearTimeout(confirmation);
    confirmation = null;
    confirming = false;
  };

  /** Show "Connected" for CONNECTED_CONFIRMATION_MS, then get out of the way. */
  const startConfirmation = (): void => {
    stopConfirmation();
    confirming = true;
    publish('confirmed');
    confirmation = setTimeout(() => {
      confirmation = null;
      confirming = false;
      publish('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  return {
    get state(): ConnectionState {
      return state;
    },
    status(status: ProviderStatus): void {
      // An unloadable board keeps its message up while the provider patiently
      // retries; only a successful sync (below) takes it down. A retryable close
      // (1011 / 1003) never sets this, so it falls through to the normal badges.
      if (loadFailed) return;
      if (status === 'connected') {
        // The socket is open again. Only a connection that has already synced once
        // gets the green confirmation; the first one waits for the sync below.
        if (everSynced) startConfirmation();
        else {
          stopConfirmation();
          publish('connecting');
        }
        return;
      }
      stopConfirmation();
      publish(everSynced ? 'reconnecting' : 'connecting');
    },
    sync(synced: boolean): void {
      if (synced) {
        everSynced = true;
        // The board is readable again: whatever was wrong with loading it is gone,
        // so editing comes back on its own — no page reload.
        loadFailed = false;
        // A sync that lands during the confirmation must not cut it short: the
        // badge stays green for its full CONNECTED_CONFIRMATION_MS.
        if (confirming) return;
        publish('connected');
        return;
      }
      // The room is gone. Edits keep going into the local doc; the provider keeps
      // retrying with exponential backoff up to RECONNECT_MAX_BACKOFF_MS.
      if (loadFailed) return;
      stopConfirmation();
      publish(everSynced ? 'reconnecting' : 'connecting');
    },
    close(code: number): void {
      if (code === CLOSE_BOARD_LOAD_FAILED) {
        // The room could not load this board. Show the honest failure and lock
        // editing; the provider keeps retrying, and a later sync recovers.
        stopConfirmation();
        loadFailed = true;
        publish('load_failed');
        return;
      }
      // Every other close (including a retryable storage failure 1011 and an
      // unsupported-data close 1003) leaves the board readable and editable:
      // unsaved changes are re-sent on the next connection, so this is just
      // "Reconnecting…", never "couldn't be loaded".
      if (loadFailed) return;
      stopConfirmation();
      publish(everSynced ? 'reconnecting' : 'connecting');
    },
    destroy(): void {
      destroyed = true;
      stopConfirmation();
    },
  };
}

/**
 * Connect `doc` to the room for `boardId` and report connection changes through
 * `onState`. Returns `destroy()`, which must be called on unmount or when the
 * board changes.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomServerUrl(), boardId, doc, {
    // Never let two tabs of the same browser short-circuit the room.
    disableBc: true,
    // Back off to at most this between attempts, so a brief server restart is
    // followed patiently instead of hammered.
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Keep retrying whatever closed the socket. y-websocket treats 4000–4999 as
    // permanent by default, but our load-failure close (CLOSE_BOARD_LOAD_FAILED =
    // 4500) is exactly the case that must keep retrying: the badge says "Retrying…"
    // and a board that becomes loadable again should recover on its own, with no
    // page reload. Editing stays locked meanwhile, so a retry can only help.
    shouldReconnect: () => true,
  });

  const tracker = createConnectionTracker(onState);
  const onProviderStatus = ({ status }: { status: ProviderStatus }): void => {
    tracker.status(status);
  };
  const onProviderSync = (synced: boolean): void => {
    tracker.sync(synced);
  };
  // The room reports an unloadable board by closing the socket with
  // CLOSE_BOARD_LOAD_FAILED; the close event carries that code.
  const onProviderClose = (event: { code: number } | null): void => {
    if (event) tracker.close(event.code);
  };
  provider.on('status', onProviderStatus);
  provider.on('sync', onProviderSync);
  provider.on('connection-close', onProviderClose);

  return {
    destroy(): void {
      provider.off('status', onProviderStatus);
      provider.off('sync', onProviderSync);
      provider.off('connection-close', onProviderClose);
      tracker.destroy();
      provider.destroy();
    },
  };
}
