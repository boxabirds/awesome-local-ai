/**
 * sync.client: the connection between this page's `Y.Doc` and the board's room.
 *
 * `connectBoard` wires a `y-websocket` provider to `/api/rooms/<boardId>` and
 * translates the provider's events into the four states the badge understands.
 * The provider does the syncing (and retries with exponential backoff capped at
 * RECONNECT_MAX_BACKOFF_MS); the only judgement made here is *which* state the
 * user should be told about, because "connected" is only true once the board's
 * content has arrived, and a connection that came back after a drop deserves a
 * short green "Connected" before the badge disappears.
 */

import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * `connecting`     first load, board not there yet
 * `connected`      in sync with the room (badge hidden)
 * `reconnecting`   a connection that worked has dropped; edits stay local
 * `confirmed`      just came back, showing "Connected" for CONNECTED_CONFIRMATION_MS
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * The part of `WebsocketProvider` the state mapping uses, so the mapping can be
 * driven by an emitter in tests instead of by a socket.
 */
export interface ProviderEvents {
  on(event: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(event: 'sync', handler: (synced: boolean) => void): void;
  off(event: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  off(event: 'sync', handler: (synced: boolean) => void): void;
}

export interface BoardConnection {
  destroy(): void;
  /**
   * How many sockets this page has opened at the room, retries included. A
   * connection that is meant to stay up can be checked for doing nothing; a
   * destroyed one must stop trying.
   */
  connectionAttempts(): number;
}

/** WebSocket root for this deployment: same host as the page, ws/wss scheme. */
function websocketRoot(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/rooms`;
}

/**
 * Map provider events onto connection states. `onState` is called only on
 * change worth showing: the first sync hides the badge straight away, while a
 * sync that follows an interruption shows "Connected" briefly (state
 * `confirmed`) before going back to `connected`.
 *
 * A real provider reports `connected` a moment before the board's content has
 * been synced, so `sync(true)` is what ends `connecting`.
 */
export function observeConnectionStatus(
  provider: ProviderEvents,
  onState: (state: ConnectionState) => void,
): () => void {
  let everSynced = false;
  let confirmation: ReturnType<typeof setTimeout> | undefined;

  const cancelConfirmation = () => {
    if (confirmation !== undefined) {
      clearTimeout(confirmation);
      confirmation = undefined;
    }
  };

  const onStatus = () => {
    cancelConfirmation();
    // Every unsynchronized moment looks the same from here: before the board has
    // ever arrived it is the initial load, after it an interruption the user
    // should see. (`sync(true)` is what ends either.)
    onState(everSynced ? 'reconnecting' : 'connecting');
  };

  const onSync = (synced: boolean) => {
    cancelConfirmation();
    if (!synced) return; // the status events say the same thing more precisely
    const wasOffline = everSynced;
    everSynced = true;
    if (!wasOffline) {
      onState('connected');
      return;
    }
    onState('confirmed');
    confirmation = setTimeout(() => {
      confirmation = undefined;
      onState('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);
  return () => {
    cancelConfirmation();
    provider.off('status', onStatus);
    provider.off('sync', onSync);
  };
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(websocketRoot(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Tabs of the same browser must not sync through a BroadcastChannel: the
    // room is the only source of other people's changes, so the tests (and the
    // product promise) are about the real path.
    disableBc: true,
  });

  const unobserve = observeConnectionStatus(provider, onState);
  onState('connecting');

  // The provider dials as it is constructed — before this listener exists — so the
  // count starts at that first dial and every retry after it is added on.
  let attempts = 1;
  const countAttempt = (event: { status: ProviderStatus }) => {
    if (event.status === 'connecting') attempts += 1;
  };
  provider.on('status', countAttempt);

  let destroyed = false;

  return {
    destroy() {
      if (destroyed) return; // leaving the board and a test can both ask for this
      destroyed = true;
      provider.off('status', countAttempt);
      unobserve();
      // Tells the room this client is leaving, then closes the socket.
      provider.awareness.destroy();
      provider.destroy();
    },
    connectionAttempts: () => attempts,
  };
}
