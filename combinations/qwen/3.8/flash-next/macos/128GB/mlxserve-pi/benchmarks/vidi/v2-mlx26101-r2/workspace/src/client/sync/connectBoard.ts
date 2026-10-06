import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config.js';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol.js';
import {
  IS_TEST_MODE,
  clearConnectionTestHooks,
  registerConnectionTestHooks,
} from '../canvas/testHooks.js';
import type { Vidi6ConnectionTestHooks } from '../canvas/testHooks.js';

/** Where the rooms are mounted (design "worker.entry"). */
export const ROOM_ROUTE_PREFIX = '/api/rooms';

/**
 * What the connection badge can show. `connected` is shown as nothing at all:
 * a board that is in step with its room needs no badge. `confirmed` is the
 * momentary "Connected" shown after the connection came back.
 *
 * `load_failed` is not one of the others. Every other state is about the
 * connection - can this page reach the room - and the answer changes by itself,
 * so the badge is a status. `load_failed` is about the board: the room answered,
 * looked, and could not open what was asked for. Nothing is going to improve on
 * its own, which is why it says a different sentence in a different colour and
 * why it is the one state in which the board does not accept edits.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Whether the board accepts edits.
 *
 * The board is readable in every state - a board that arrived once stays on the
 * screen when the room goes away, and a board that could not be loaded still
 * shows whatever this page has of it - but a board the room will not open cannot
 * take anything back, so an edit made while `load_failed` is an edit the user
 * believes they made. Locking is the honest half of the message: the sentence
 * says what went wrong, and the disabled control is the same sentence acted on.
 *
 * Everything else - the camera, selection, what is already typed into an open
 * editor - stays available, because none of it needs the room to survive.
 */
export const canEdit = (state: ConnectionState): boolean => state !== 'load_failed';

/** The statuses the y-websocket provider reports. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * The connection as far as the status machine is concerned: hear about the
 * provider, and hang up. `WebsocketProvider` sits behind `createLink`, so the
 * mapping from provider events to badge states is testable with a fake emitter.
 */
export interface BoardLink {
  /**
   * Called with the provider's status and whether it is in step with the room.
   * Called again on every change of either, and with the current values when
   * the provider is already past them (the provider reports "connecting" itself
   * as it opens, so the machine has one source of truth).
   */
  onStatus(listener: (status: ProviderStatus, synced: boolean) => void): void;
  /**
   * Called with the close code of every socket that closes, `null` when this page
   * hung up itself (`provider.disconnect()`, or the watchdog - neither has a code
   * because no server ever sent one).
   *
   * The status listener cannot carry this: "disconnected" is the same word for a
   * dropped network and for a room that looked at the board and refused it, and
   * the difference between those two is the whole story.
   */
  onClose(listener: (code: number | null) => void): void;
  destroy(): void;
}

export interface ConnectOptions {
  /** How to get the link; tests hand in a fake. Defaults to `createProviderLink`. */
  createLink?(boardId: string, doc: Y.Doc): BoardLink;
}

/** A board connection that can be hung up when the board unmounts. */
export interface BoardConnection {
  destroy(): void;
}

/** `ws(s)://host` for the page the client is on. */
const socketOrigin = (): string => {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
};

/**
 * The real link: a `WebsocketProvider` on `/api/rooms/<boardId>`.
 *
 * `disableBc: true` — no BroadcastChannel. Two tabs of the same browser have to
 * go through the room like everyone else, otherwise a tab would keep converging
 * with its neighbour while the room was down and the outage would not be visible.
 * `maxBackoffTime` is the design's retry ceiling. The provider's own `Awareness`
 * is left alone: story 3 relays those bytes without ever reading them (story 6
 * will be the one that puts state in it).
 */
export function createProviderLink(boardId: string, doc: Y.Doc): BoardLink {
  const provider = new WebsocketProvider(
    `${socketOrigin()}${ROOM_ROUTE_PREFIX}`,
    boardId,
    doc,
    { maxBackoffTime: RECONNECT_MAX_BACKOFF_MS, disableBc: true },
  );
  const listeners: Array<(status: ProviderStatus, synced: boolean) => void> = [];
  const closeListeners: Array<(code: number | null) => void> = [];

  // The provider's status and sync events are read together, so a listener never
  // sees a pair that never happens (a socket that is "connected" is reported
  // before it has synced, and `synced` goes false again when it drops).
  const report = (): void => {
    const status: ProviderStatus = provider.wsconnected
      ? 'connected'
      : provider.wsconnecting
        ? 'connecting'
        : 'disconnected';
    for (const listener of [...listeners]) listener(status, provider.synced);
  };

  // y-websocket emits both 'synced' and 'sync'; 'sync' is the declared event.
  provider.on('status', report);
  provider.on('sync', report);

  // y-websocket emits `connection-close` for every socket that closes, with the
  // CloseEvent - or `null` when the close was ours. It is emitted before the
  // `disconnected` status, so a listener is told what the room said before it is
  // told that the room is gone.
  provider.on('connection-close', (event: CloseEvent | null) => {
    for (const listener of [...closeListeners]) listener(event?.code ?? null);
  });

  // Test build only: an e2e test can cut this connection and restore it, which
  // is how it tests an outage (see Vidi6ConnectionTestHooks).
  const testHooks: Vidi6ConnectionTestHooks | null = IS_TEST_MODE
    ? {
        dropConnection: () => provider.disconnect(),
        restoreConnection: () => provider.connect(),
      }
    : null;
  if (testHooks) registerConnectionTestHooks(testHooks);

  return {
    onStatus(listener) {
      listeners.push(listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
    },
    destroy() {
      if (testHooks) clearConnectionTestHooks(testHooks);
      provider.off('status', report);
      provider.off('sync', report);
      provider.destroy();
    },
  };
}

/**
 * Attach `doc` to the room for `boardId` and report a `ConnectionState` to
 * `onState` (design "sync.client").
 *
 * The mapping, and the reason for each step:
 *
 * - not in step with the room yet, and never has been → `connecting`
 *   ("Connecting…" is only ever a first-load message);
 * - in step → `connected`, which renders nothing;
 * - in step and then not → `reconnecting`, which is the only case in which the
 *   user is told the room is out of reach;
 * - back in step after an interruption → `confirmed` ("Connected") for
 *   `CONNECTED_CONFIRMATION_MS`, so the user sees the recovery as well as the
 *   failure, and then `connected`;
 * - closed with {@link CLOSE_BOARD_LOAD_FAILED} → `load_failed`, and it stays
 *   there until a sync gets through.
 *
 * The close code is read because the status cannot say this. A room that cannot
 * open the board accepts the socket and closes it with 4500; a room that has lost
 * the network, crashed, or run out of storage closes it with nothing, or with
 * 1011. Both arrive here as "not connected". The first means stop typing; the
 * second means keep going, because the retry will carry what you typed - so the
 * one becomes a lock and the other does not, and only the number says which.
 *
 * While the board is in `load_failed` nothing short of a sync changes the badge:
 * the retries the provider makes on its own open and close sockets, and each of
 * those would otherwise flip the message between "This board couldn't be loaded"
 * and "Reconnecting…" - the second being the one thing that is not true about it.
 *
 * The provider retries with exponential backoff on its own; this function only
 * translates. It reports `connecting` synchronously, before the socket opens.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectOptions = {},
): BoardConnection {
  const createLink = options.createLink ?? createProviderLink;
  let state: ConnectionState | null = null;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const stopConfirmation = (): void => {
    if (confirmation !== null) {
      clearTimeout(confirmation);
      confirmation = null;
    }
  };

  const setState = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    onState(next);
  };

  const link = createLink(boardId, doc);

  link.onClose((code) => {
    // Only the room's own "I could not open this board" is read. 1011 and every
    // other code - including a close with no code at all, which is what a socket
    // this page hung up reports - are left to the status listener below, which
    // reads them as an interruption: correct for them, and wrong for this one.
    if (code === CLOSE_BOARD_LOAD_FAILED) {
      stopConfirmation();
      setState('load_failed');
    }
  });

  link.onStatus((status, synced) => {
    if (status === 'connected' && synced) {
      stopConfirmation();
      // Coming back to the room after an interruption is worth announcing;
      // arriving here for the first time is not. A board that had failed to load
      // goes straight to `connected` rather than through "Connected": the red
      // message going away is the announcement, and a green one on top of it
      // would be a second way of saying that it worked.
      const next =
        state === 'load_failed' ? 'connected' : state === 'reconnecting' ? 'confirmed' : 'connected';
      setState(next);
      if (next === 'confirmed') {
        confirmation = setTimeout(() => {
          confirmation = null;
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
      return;
    }

    if (state === 'load_failed') {
      // The board could not be loaded and still cannot: a retry opening a socket
      // and losing it again is not new information, and the message above is
      // still the true one. Only a sync gets the board out of this state.
      return;
    }

    if (state === 'connected' || state === 'confirmed') {
      // It was in step with the room and now it is not.
      stopConfirmation();
      setState('reconnecting');
      return;
    }

    // Never in step yet. While a retry is already under way the badge keeps
    // saying what it was saying: a board that has been in the room does not go
    // back to "Connecting…".
    if (state !== 'reconnecting') setState('connecting');
  });

  // Before the socket opens, so the badge is right from the first render.
  setState('connecting');

  return {
    destroy() {
      stopConfirmation();
      link.destroy();
    },
  };
}
