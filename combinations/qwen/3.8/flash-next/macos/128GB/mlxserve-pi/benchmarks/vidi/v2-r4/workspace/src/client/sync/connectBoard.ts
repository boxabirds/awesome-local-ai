/**
 * The client's connection to a board: one `WebsocketProvider` per tab, plus the
 * mapping from the provider's status and sync events onto the states the
 * interface shows.
 *
 * BroadcastChannel is switched off deliberately: with it on, two tabs of the
 * same browser would sync with each other around the server and the tests would
 * pass while the server path was broken.
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/** What the interface shows about this tab's connection. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * How often this tab says "still here".
 *
 * The provider closes a connection it has heard nothing on for 30 seconds, and
 * says so itself: "not even your own awareness updates (which are updated every 15
 * seconds)" — a y-websocket server renews everybody's awareness on that cadence.
 * This room relays awareness but does not renew it (renewing it is presence, and
 * presence is story 6), so each client renews its own, and the room's relay of it
 * is what keeps an idle board's connections looking alive.
 */
const AWARENESS_RENEWAL_MS = 15_000;

/** The connection, so the tab can hand the document back on unmount. */
export interface BoardConnection {
  destroy(): void;
}

type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** The two events `connectBoard` listens to, so a test can feed a fake provider. */
export interface ProviderEvents {
  on(event: 'status', listener: (event: { status: ProviderStatus }) => void): unknown;
  on(event: 'synced', listener: (synced: boolean) => void): unknown;
  off(event: 'status', listener: (event: { status: ProviderStatus }) => void): unknown;
  off(event: 'synced', listener: (synced: boolean) => void): unknown;
}

/**
 * Translates a provider's `status` and `synced` events into connection states,
 * calling `onState` whenever the state changes, and stops listening when the
 * returned function is called.
 *
 * The mapping is the client connection state diagram: `connecting` until the
 * document is synced for the first time, then `connected`; a drop after having
 * been connected is `reconnecting`; coming back is `confirmed` for
 * CONNECTED_CONFIRMATION_MS and then `connected` again, which is what lets the
 * badge say "Connected" briefly and then get out of the way.
 */
export function trackConnectionState(
  provider: ProviderEvents,
  onState: (state: ConnectionState) => void,
): () => void {
  let state: ConnectionState = 'connecting';
  /** Set once the document has been in sync, so a later drop is a reconnection. */
  let syncedOnce = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmation = (): void => {
    if (confirmation === null) return;
    clearTimeout(confirmation);
    confirmation = null;
  };

  const publish = (next: ConnectionState): void => {
    clearConfirmation();
    if (next === 'confirmed') {
      confirmation = setTimeout(() => {
        confirmation = null;
        publish('connected');
      }, CONNECTED_CONFIRMATION_MS);
    }
    if (state === next) return;
    state = next;
    onState(next);
  };

  const onStatus = ({ status }: { status: ProviderStatus }): void => {
    if (status === 'disconnected') {
      // Losing the socket before it was ever in sync is still the first attempt.
      if (syncedOnce) publish('reconnecting');
      return;
    }
    if (status === 'connecting' && !syncedOnce) publish('connecting');
  };

  const onSynced = (synced: boolean): void => {
    if (!synced) return;
    const wasReconnecting = state === 'reconnecting';
    syncedOnce = true;
    publish(wasReconnecting ? 'confirmed' : 'connected');
  };

  provider.on('status', onStatus);
  provider.on('synced', onSynced);

  return () => {
    clearConfirmation();
    provider.off('status', onStatus);
    provider.off('synced', onSynced);
  };
}

/** The WebSocket server address of this page: `ws://host` or `wss://host`. */
export function boardSocketOrigin(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/rooms`;
}

/**
 * Connects `doc` to the board called `boardId` and reports connection states to
 * `onState`. The provider does the whole of y-websocket's side: initial sync in
 * both directions, sending every local update, reconnection with backoff up to
 * RECONNECT_MAX_BACKOFF_MS, and a full re-sync when the socket comes back —
 * which is how edits made while offline catch up.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(boardSocketOrigin(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });
  const stopTracking = trackConnectionState(provider, onState);

  // A field of our own awareness state, refreshed on the cadence above. It says
  // nothing a board acts on — it is the heartbeat, and it travels over the same
  // awareness messages a cursor will use from story 6 on.
  const renew = setInterval(() => {
    provider.awareness.setLocalStateField('renewedAt', Date.now());
  }, AWARENESS_RENEWAL_MS);

  return {
    destroy(): void {
      clearInterval(renew);
      stopTracking();
      provider.disconnect();
      provider.destroy();
    },
  };
}
