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
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/**
 * What the badge shows. `confirmed` is the green moment right after a drop;
 * `load_failed` is the board itself being unreadable, which is not a state of the
 * connection — the connection is fine, the board is not — and so is not cleared
 * by the connection events that clear every other state.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

export interface BoardConnection {
  /** Close the socket and stop listening to the document. */
  destroy(): void;
}

/** The provider events this file cares about. */
export interface ProviderEvents {
  status: { status: 'connecting' | 'connected' | 'disconnected' };
  sync: [isSynced: boolean];
  /**
   * y-websocket forwards the close frame the room sent, code included — or null
   * when the socket went away without one (a destroyed provider).
   */
  'connection-close': CloseEvent | null;
}

/**
 * Where connection state goes: the provider's `status` and `sync` events are
 * translated into one of four states the badge can show. Kept as an interface
 * so the state machine can live outside the connection that feeds it.
 */
export interface ConnectionStateSink {
  status(status: ProviderEvents['status']['status']): void;
  synced(isSynced: boolean): void;
  /** The room closed the connection because it could not read the board. */
  loadFailed(): void;
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
 * Story 4 adds one state and one way into it: a connection the room closed with
 * CLOSE_BOARD_LOAD_FAILED is the board being unreadable, which no connection
 * event undoes — only a sync that brings the board does, and it goes straight to
 * `connected` rather than through the green confirmation flash.
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
  // `true` while the room has told us it cannot read this board. It outlives every
  // connection event on purpose: the connection comes back on its own, and a
  // state the connection clears would say the board is fine before it is.
  let boardUnreadable = false;
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
      if (boardUnreadable) return;
      if (status !== 'connected') show(hasSynced ? 'reconnecting' : 'connecting');
    },
    loadFailed(): void {
      boardUnreadable = true;
      // This board has not been seen. Whatever we are shown next is a first sight
      // of it, not a recovery to be celebrated with a green flash.
      hasSynced = false;
      show('load_failed');
    },
    synced(isSynced: boolean): void {
      if (boardUnreadable) {
        // Until the board is actually in front of us, every connection event
        // leaves the message standing where it is.
        if (isSynced) {
          boardUnreadable = false;
          hasSynced = true;
          show('connected');
        }
        return;
      }
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
  // The one thing the room can tell us that is about the board rather than about
  // the way to it: it could not read this board. Every other close code is left
  // to `status` and `sync`, which already say what is true about the connection.
  const onClose = (event: ProviderEvents['connection-close']): void => {
    if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) sink.loadFailed();
  };
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('connection-close', onClose);

  return {
    destroy(): void {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('connection-close', onClose);
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
