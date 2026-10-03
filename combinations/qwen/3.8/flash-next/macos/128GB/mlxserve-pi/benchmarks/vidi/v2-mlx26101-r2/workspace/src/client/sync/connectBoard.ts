import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config.js';
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
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

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
 *   failure, and then `connected`.
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

  link.onStatus((status, synced) => {
    if (status === 'connected' && synced) {
      stopConfirmation();
      // Coming back to the room after an interruption is worth announcing;
      // arriving here for the first time is not.
      const next = state === 'reconnecting' ? 'confirmed' : 'connected';
      setState(next);
      if (next === 'confirmed') {
        confirmation = setTimeout(() => {
          confirmation = null;
          setState('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
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
