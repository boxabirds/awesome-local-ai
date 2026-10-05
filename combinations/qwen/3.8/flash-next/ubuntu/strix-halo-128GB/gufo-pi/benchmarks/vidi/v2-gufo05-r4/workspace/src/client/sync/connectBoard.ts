/**
 * The browser's connection to a board.
 *
 * `connectBoard` attaches a `y-websocket` provider to the board's `Y.Doc` and
 * turns the provider's own events into the states the interface understands.
 * Nothing else in the app reads the provider: the document is the seam, so the
 * board stays fully editable while the network is down and the edits made then go
 * out by themselves when the connection returns (`live.catch_up`).
 *
 * Two provider settings matter:
 *  - `maxBackoffTime: RECONNECT_MAX_BACKOFF_MS` — retries back off exponentially
 *    and never wait longer than that setting;
 *  - `disableBc: true` — no cross-tab BroadcastChannel. Tabs in the same browser
 *    have to go through the server, otherwise a test with two tabs could pass
 *    while the server path is broken.
 */

import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { registerTestHooks } from '../canvas/testHooks';

/**
 * `connecting`   first load, nothing synced yet ("Connecting…")
 * `connected`    open and in sync (no badge)
 * `reconnecting` an established connection was lost ("Reconnecting…")
 * `confirmed`    just came back; the confirmation badge shows for CONNECTED_CONFIRMATION_MS
 * `load_failed`  the room said it could not open this board (4500) — red, and the
 *                board is not editable until it loads (story 4: a board that could not
 *                be read must not be written to, because what is written would be lost)
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Is the user allowed to change the board right now?
 *
 * Everything except a board that could not be loaded: an outage still leaves a board
 * you can write on, because the document is the thing and it will catch up by itself.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** The provider events this module cares about (`WebsocketProvider` satisfies it). */
export interface ProviderEvents {
  on(event: 'status', handler: (event: { status: string }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  on(event: 'connection-close', handler: (event: { code: number } | null) => void): void;
  off(event: 'status', handler: (event: { status: string }) => void): void;
  off(event: 'sync', handler: (synced: boolean) => void): void;
  off(event: 'connection-close', handler: (event: { code: number } | null) => void): void;
}

/** The provider-independent half of the mapping, so it can be tested directly. */
export interface ConnectionMachine {
  /** The state the machine currently reports. */
  readonly state: ConnectionState;
  /** A `status` event from the provider. */
  providerStatus(status: string): void;
  /** A `sync` event from the provider. */
  providerSync(synced: boolean): void;
  /**
   * A `connection-close` event: the room's own verdict on this connection. `null`
   * means we closed it here, which is not a message about the board.
   */
  providerClose(event: { code: number } | null): void;
  /** Stop any pending confirmation. */
  destroy(): void;
}

/** The handle `useBoardDoc` keeps: the provider plus the mapped state. */
export interface BoardConnection {
  destroy(): void;
}

/**
 * The state machine of the state diagram: `connecting` until the first sync,
 * `connected` while in sync, `reconnecting` when a connection that had synced goes
 * away, and `confirmed` for CONNECTED_CONFIRMATION_MS after it comes back.
 *
 * A provider that never connected (a server that is simply not there yet) is still
 * `connecting`, not `reconnecting`: nothing was lost.
 */
export function createConnectionMachine(onState: (state: ConnectionState) => void): ConnectionMachine {
  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };

  const cancelConfirmation = () => {
    if (confirmation === null) return;
    clearTimeout(confirmation);
    confirmation = null;
  };

  return {
    get state() {
      return state;
    },
    providerStatus(status: string): void {
      if (status === 'disconnected') {
        // A connection that had synced is an outage; one that never got there is
        // still the first load.
        if (everSynced) {
          cancelConfirmation();
          publish('reconnecting');
        }
        return;
      }
      // A board the room refused to load is the one thing a retry attempt does not
      // make vaguer: the red message stays until a sync says otherwise.
      if (state === 'load_failed') return;
      if (status === 'connecting' && everSynced && state !== 'reconnecting') {
        // Retrying after an outage: the amber badge stays up while we are trying.
        cancelConfirmation();
        publish('reconnecting');
      }
    },
    providerClose(event: { code: number } | null): void {
      if (event !== null && event.code === CLOSE_BOARD_LOAD_FAILED) {
        cancelConfirmation();
        publish('load_failed');
        return;
      }
      // Any other code — 1011 for a storage failure, 1003 for a frame the room could
      // not read, or a close we caused ourselves — says nothing about the board's
      // content, which is still there and still worth editing. The provider is already
      // trying again, so this is the same state an outage is.
      if (event === null && !everSynced) return;
      cancelConfirmation();
      publish('reconnecting');
    },
    providerSync(synced: boolean): void {
      if (!synced) return;
      if (state === 'load_failed') {
        // The board loaded. No green celebration over a scare like that: the message
        // simply stops being true, and editing comes back with it, without a reload.
        everSynced = true;
        publish('connected');
        return;
      }
      const returning = everSynced;
      everSynced = true;
      if (returning && state !== 'connected') {
        // Back: green confirmation, then nothing at all.
        cancelConfirmation();
        publish('confirmed');
        confirmation = setTimeout(() => {
          confirmation = null;
          publish('connected');
        }, CONNECTED_CONFIRMATION_MS);
        return;
      }
      if (!returning) publish('connected');
    },
    destroy(): void {
      cancelConfirmation();
    }
  };
}

/**
 * Wire a machine to a provider's `status` and `sync` events. Kept separate from
 * `connectBoard` so the component tests drive exactly this wiring with a fake
 * provider instead of the real socket. Returns the detach function.
 */
export function attachConnectionMachine(machine: ConnectionMachine, provider: ProviderEvents): () => void {
  const onStatus = (event: { status: string }) => machine.providerStatus(event.status);
  const onSync = (synced: boolean) => machine.providerSync(synced);
  const onClose = (event: { code: number } | null) => machine.providerClose(event);
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('connection-close', onClose);
  return () => {
    provider.off('status', onStatus);
    provider.off('sync', onSync);
    provider.off('connection-close', onClose);
  };
}

/** `wss:` on https, `ws:` otherwise, always on the page's own host. */
export function roomEndpoint(): string {
  const secure = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${secure}//${window.location.host}/api/rooms`;
}

/**
 * Connect `doc` to the room named `boardId` and report every state change to
 * `onState`. `destroy()` closes the socket and stops reporting; call it on unmount
 * or when the board changes.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void
): BoardConnection {
  const provider = new WebsocketProvider(roomEndpoint(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true
  });
  const machine = createConnectionMachine(onState);
  const detach = attachConnectionMachine(machine, provider);
  // So a test can take the link away and give it back (see `Vidi6TestHooks`).
  const releaseHooks = registerTestHooks({
    dropConnection: () => provider.disconnect(),
    resumeConnection: () => provider.connect()
  });
  return {
    destroy(): void {
      releaseHooks();
      detach();
      machine.destroy();
      void provider.destroy();
    }
  };
}
