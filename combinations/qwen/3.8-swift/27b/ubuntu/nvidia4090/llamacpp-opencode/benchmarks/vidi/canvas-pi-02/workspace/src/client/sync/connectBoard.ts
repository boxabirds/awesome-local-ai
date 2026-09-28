// Client connection (story 3, sync.client): attaches a y-websocket
// WebsocketProvider to the board's Y.Doc at /api/rooms/<boardId> and derives
// the connection badge state from provider `status` and `sync` events.
//
// State machine (see design state diagram):
//   connecting  — initial, until the socket is open and synced
//   connected   — stable (badge hidden)
//   reconnecting— was connected, socket closed (amber "Reconnecting…")
//   confirmed   — open and synced again after a drop; the green "Connected"
//                 badge shows for CONNECTED_CONFIRMATION_MS, then connected
//
// trackConnectionState is the pure core: fold provider events (with
// timestamps) into a state as of `now`. The live wiring below uses the same
// function so unit/component tests and the app can never drift apart.

import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed';

/** One observed provider fact: status and sync flag at a moment in time. */
export interface ProviderEvent {
  status: 'connecting' | 'connected' | 'disconnected';
  synced: boolean;
  /** Epoch milliseconds (injectable clock in tests). */
  at: number;
}

/**
 * Pure connection state machine. Folds `events` (chronological) and returns
 * the badge state as of `now`.
 *
 * - `connecting`  — until the first time the socket is open AND synced.
 * - `connected`   — that first open-and-synced moment (badge hidden).
 * - `reconnecting`— any later moment the socket is not open-and-synced.
 * - `confirmed`   — the next open-and-synced moment after a drop; becomes
 *   `connected` once `confirmationMs` have elapsed without another drop.
 */
export function trackConnectionState(
  events: ProviderEvent[],
  confirmationMs: number,
  now: number,
): ConnectionState {
  let state: ConnectionState = 'connecting';
  let everConnected = false;
  let confirmedAt: number | null = null;
  for (const ev of events) {
    if (ev.status === 'connected' && ev.synced) {
      if (everConnected) {
        state = 'confirmed';
        confirmedAt = ev.at;
      } else {
        state = 'connected';
        everConnected = true;
        confirmedAt = null;
      }
    } else {
      state = everConnected ? 'reconnecting' : 'connecting';
      confirmedAt = null;
    }
  }
  if (state === 'confirmed' && confirmedAt !== null && now - confirmedAt >= confirmationMs) {
    state = 'connected';
  }
  return state;
}

export interface BoardConnection {
  /** Current badge state. */
  readonly state: ConnectionState;
  /**
   * Test-only: simulate a network drop for this client. Every subsequent
   * (re)connection attempt opens a socket that closes immediately, so the
   * provider stays in `disconnected` status and keeps retrying with backoff
   * — exactly what a flaky Wi-Fi does — until `restoreNetwork()`.
   */
  dropNetwork?(): void;
  /** Test-only: undo `dropNetwork()`, letting the next reconnect succeed. */
  restoreNetwork?(): void;
  /** Tears down the provider (and any pending timers). */
  destroy(): void;
}

/**
 * Live tracker: feeds provider facts into trackConnectionState and applies
 * the CONNECTED_CONFIRMATION_MS window with real (or fake, in tests)
 * timers. `onState` fires on every state change.
 */
export interface ConnectionTracker {
  readonly state: ConnectionState;
  /** Records one provider fact (status and/or sync change). */
  feed(status: ProviderEvent['status'], synced: boolean): void;
  /** Cancels any pending confirmation timer. */
  dispose(): void;
}

export function createConnectionTracker(
  onState?: (state: ConnectionState) => void,
  now: () => number = () => Date.now(),
): ConnectionTracker {
  const events: ProviderEvent[] = [];
  let state: ConnectionState = 'connecting';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const apply = (at: number): void => {
    const next = trackConnectionState(events, CONNECTED_CONFIRMATION_MS, at);
    if (next !== state) {
      state = next;
      onState?.(state);
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (state === 'confirmed') {
      timer = setTimeout(() => {
        timer = null;
        apply(now());
      }, CONNECTED_CONFIRMATION_MS);
    }
  };

  return {
    get state() {
      return state;
    },
    feed: (status: ProviderEvent['status'], synced: boolean): void => {
      events.push({ status, synced, at: now() });
      apply(now());
    },
    dispose: (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Attaches a WebsocketProvider to `doc` for `boardId` and derives the badge
 * state. `onState` fires whenever the state changes (not for the initial
 * `connecting`).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState?: (state: ConnectionState) => void,
): BoardConnection {
  const awareness = new Awareness(doc);
  const proto =
    window.location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(
    `${proto}://${window.location.host}/api/rooms`,
    boardId,
    doc,
    {
      awareness,
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      // Without the server as the sync path, tabs in one browser must not
      // sync to each other (tests must exercise the real server path).
      disableBc: true,
    },
  );

  // The Awareness constructor seeds a local state ({}) so y-protocols renews
  // it every ~15 s; the room's awareness relay (and periodic keep-alive ping)
  // then keep y-websocket's 30 s no-message watchdog from dropping idle
  // connections. Story 6 (presence) replaces the placeholder with real data.
  const tracker = createConnectionTracker(onState);
  let lastStatus: ProviderEvent['status'] = 'connecting';
  const onStatus = (e: { status: ProviderEvent['status'] }): void => {
    lastStatus = e.status;
    tracker.feed(e.status, provider.synced);
  };
  const onSync = (synced: boolean): void => {
    tracker.feed(lastStatus, synced);
  };
  provider.on('status', onStatus);
  provider.on('sync', onSync);

  // Simulate a dropped network with the provider's own connect/disconnect API:
  // `disconnect()` closes the socket and stops reconnection (the client stays
  // `disconnected` with no churn), and `connect()` opens a fresh socket and
  // re-runs the sync handshake. This faithfully models a flaky Wi-Fi drop.
  return {
    get state() {
      return tracker.state;
    },
    dropNetwork: (): void => {
      provider.disconnect();
    },
    restoreNetwork: (): void => {
      provider.connect();
    },
    destroy: () => {
      tracker.dispose();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
