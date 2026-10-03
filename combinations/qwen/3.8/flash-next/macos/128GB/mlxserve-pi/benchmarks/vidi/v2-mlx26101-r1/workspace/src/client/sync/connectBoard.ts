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

/**
 * What the connection currently is, as shown by `ConnectionStatus`:
 * first load, in sync, lost while edits keep working, or freshly back and
 * confirming before the badge hides.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** A connection you can hand back to React's cleanup. */
export interface BoardConnection {
  destroy(): void;
}

/** The provider's own connection events, in the order they arrive. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * The state machine behind `connectBoard`, split out so the badge's timing is
 * testable with fake timers and a plain event emitter instead of a real provider.
 * It starts in `connecting` (the first load) and is driven by the two provider
 * events `status` and `sync`.
 */
export interface ConnectionTracker {
  /** The state the badge should show right now. */
  readonly state: ConnectionState;
  status(status: ProviderStatus): void;
  sync(synced: boolean): void;
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
        // A sync that lands during the confirmation must not cut it short: the
        // badge stays green for its full CONNECTED_CONFIRMATION_MS.
        if (confirming) return;
        publish('connected');
        return;
      }
      // The room is gone. Edits keep going into the local doc; the provider keeps
      // retrying with exponential backoff up to RECONNECT_MAX_BACKOFF_MS.
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
  });

  const tracker = createConnectionTracker(onState);
  const onProviderStatus = ({ status }: { status: ProviderStatus }): void => {
    tracker.status(status);
  };
  const onProviderSync = (synced: boolean): void => {
    tracker.sync(synced);
  };
  provider.on('status', onProviderStatus);
  provider.on('sync', onProviderSync);

  return {
    destroy(): void {
      provider.off('status', onProviderStatus);
      provider.off('sync', onProviderSync);
      tracker.destroy();
      provider.destroy();
    },
  };
}
