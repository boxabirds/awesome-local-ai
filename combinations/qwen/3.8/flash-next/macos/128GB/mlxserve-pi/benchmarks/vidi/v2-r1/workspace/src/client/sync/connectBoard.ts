// Copyright 2026 Board Room contributors. All rights reserved.
//
// The browser side of a live board: one WebSocket to the board's room, and the
// connection state the badge shows. Selection and editing are NOT here — they
// stay on this screen (`live.local_selection`).
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';

/** What the badge shows. `confirmed` is the green moment right after a drop. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  /** Close the socket and stop listening to the document. */
  destroy(): void;
}

/** The provider events this file cares about. */
export interface ProviderEvents {
  status: { status: 'connecting' | 'connected' | 'disconnected' };
  sync: [isSynced: boolean];
}

/**
 * Where connection state goes: the provider's `status` and `sync` events are
 * translated into one of four states the badge can show. Kept as an interface
 * so the state machine can live outside the connection that feeds it.
 */
export interface ConnectionStateSink {
  status(status: ProviderEvents['status']['status']): void;
  synced(isSynced: boolean): void;
}

/**
 * A fake-provider seam for tests: the same mapping the provider's events drive,
 * driven by hand with fake timers (design: "Timers in badge component test —
 * fake timers"; "fake provider event emitter").
 */
export interface ConnectionStateTracker extends ConnectionStateSink {
  destroy(): void;
}

/**
 * The state machine of the design's client state diagram, as a pure mapping
 * from provider events to states — no sockets, so the badge timing is
 * deterministic:
 *
 *   connecting → connected                    first sync
 *   connected  → reconnecting                socket closed after we were in
 *   connecting → reconnecting                (sync is false on any drop)
 *   reconnecting → confirmed → connected     synced again, then
 *                                            CONNECTED_CONFIRMATION_MS elapsed
 *
 * A confirmed period that is interrupted by another drop starts over: the
 * state goes back to `reconnecting` at once and the green only comes back after
 * a sync that holds for the full confirmation time.
 */
export function createConnectionStateTracker(
  onState: (state: ConnectionState) => void,
): ConnectionStateTracker {
  // `true` once we have been synced at least once, which is what tells a
  // first-time "Connecting…" apart from a "Reconnecting…".
  let hasSynced = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const show = (state: ConnectionState): void => {
    if (confirmation !== null) {
      clearTimeout(confirmation);
      confirmation = null;
    }
    onState(state);
  };

  return {
    status(status): void {
      // The socket being open is not yet a usable connection: the board is
      // stale until SyncStep2 arrives, so `status: 'connected'` changes nothing
      // and `synced()` decides when the state becomes `connected`.
      if (status !== 'connected') show(hasSynced ? 'reconnecting' : 'connecting');
    },
    synced(isSynced: boolean): void {
      if (!isSynced) {
        show(hasSynced ? 'reconnecting' : 'connecting');
        return;
      }
      const isACatchUp = hasSynced;
      hasSynced = true;
      if (!isACatchUp) {
        show('connected');
        return;
      }
      show('confirmed');
      confirmation = setTimeout(() => {
        confirmation = null;
        onState('connected');
      }, CONNECTED_CONFIRMATION_MS);
      return;
    },
    destroy(): void {
      if (confirmation !== null) {
        clearTimeout(confirmation);
        confirmation = null;
      }
    },
  };
}

/** `wss://host/api/rooms` on https, `ws://host/api/rooms` otherwise. */
export const roomServerUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/rooms`;
};

/**
 * Connects `doc` to the room of `boardId` and feeds `sink` (usually the state
 * machine of `createConnectionStateTracker`) with what the provider reports.
 * The sink outlives the connection: reconnecting to the same board does not
 * forget that this board has been in sync before.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  sink: ConnectionStateSink,
): BoardConnection {
  const provider = new WebsocketProvider(roomServerUrl(), boardId, doc, {
    // The reconnect backoff must not grow past the value the settings name.
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Two tabs of the same browser must not sync through BroadcastChannel:
    // everything has to go through the room, or the tests would pass with a
    // broken server path.
    disableBc: true,
  });

  sink.status('connecting');

  const onStatus = (event: ProviderEvents['status']): void => sink.status(event.status);
  const onSync = (isSynced: boolean): void => sink.synced(isSynced);
  provider.on('status', onStatus);
  provider.on('sync', onSync);

  return {
    destroy(): void {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      void provider.destroy();
    },
  };
}

/**
 * The React side of `connectBoard`: the connection lives as long as the
 * document and the board id do, and is torn down when either changes (a board
 * switch or an unmount). The state machine itself is older than any one
 * connection, so a re-render never turns "Reconnecting…" back into
 * "Connecting…".
 */
export function useConnectionState(
  register: (sink: ConnectionStateTracker) => () => void,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  const trackerRef = useRef<ConnectionStateTracker | null>(null);
  if (trackerRef.current === null) trackerRef.current = createConnectionStateTracker(setState);
  const tracker = trackerRef.current;

  useEffect(() => register(tracker), [register, tracker]);
  // The confirmation timer belongs to the tracker, so it is the tracker that
  // has to be put down when the board leaves the screen.
  useEffect(() => () => tracker.destroy(), [tracker]);

  return state;
}
