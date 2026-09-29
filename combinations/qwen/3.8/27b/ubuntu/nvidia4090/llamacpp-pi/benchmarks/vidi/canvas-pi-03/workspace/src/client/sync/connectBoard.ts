import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS } from '@/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '@/shared/protocol';

/**
 * Client connection state (stories 3+4). Drives the status badge and the
 * `window.__vidi6.connectionState` test hook.
 *
 *  - 'connecting'   first connection in progress (never been connected yet)
 *  - 'connected'    first connection open and synced (stable)
 *  - 'reconnecting' a previously-connected socket dropped; retrying
 *  - 'confirmed'    a reconnection is open and synced; the badge shows
 *                   "Connected" for CONNECTED_CONFIRMATION_MS, then hides
 *  - 'load_failed'  the server refused the board: its persisted state cannot
 *                   be loaded (close code CLOSE_BOARD_LOAD_FAILED = 4500).
 *                   The provider keeps retrying in the background (4500 is
 *                   y-websocket's "try again later" range) and the room
 *                   retries loading on each connection; when a retry
 *                   succeeds the board syncs and the state recovers
 *                   automatically. Editing is disabled in this state.
 *
 * The confirmed -> hidden transition is owned by the ConnectionStatus
 * component (so it can be driven by fake timers in the component test);
 * connectBoard only reports which state we are in.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** Handle returned by {@link connectBoard}. */
export interface BoardConnection {
  destroy(): void;
  /** Test helper: drop the live connection (simulates a Wi-Fi outage). */
  drop(): void;
  /** Test helper: resume a dropped connection. */
  resume(): void;
}

/** The `ws(s)://host` origin for the WebSocket, derived from the page. */
function wsOrigin(): string {
  if (typeof location === 'undefined') return 'ws://localhost';
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}`;
}

/**
 * Attaches a y-websocket provider to `doc` for the given board and reports
 * connection state changes through `onState`. Returns a handle whose
 * `destroy()` tears the provider down (unmount / board change).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(`${wsOrigin()}/api/rooms`, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let everConnected = false;
  let reported: ConnectionState = 'connecting';
  const set = (s: ConnectionState): void => {
    if (s !== reported) {
      reported = s;
      onState(s);
    }
  };

  // The provider reports 'connected' when the socket opens, but we only
  // surface "connected/confirmed" once the doc is actually synced.
  const onSynced = () => {
    if (!provider.synced) return;
    if (everConnected) {
      set('confirmed');
    } else {
      everConnected = true;
      set('connected');
    }
  };

  const onStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    if (status === 'connected') {
      onSynced();
      return;
    }
    // While load_failed, the provider's own retry cycle (disconnected ->
    // connecting) must not mask the badge: the room is retrying the load,
    // not the socket.
    if (reported === 'load_failed') return;
    if (status === 'disconnected') {
      if (everConnected) set('reconnecting');
    } else {
      // 'connecting'
      set(everConnected ? 'reconnecting' : 'connecting');
    }
  };

  const onConnectionClose = (ev: { code: number; reason: string } | null): void => {
    if (!ev) return; // local close (disconnect()); nothing to report
    if (ev.code === CLOSE_BOARD_LOAD_FAILED) {
      // The board's persisted state could not be loaded. The provider keeps
      // reconnecting (4500-range is "try again later") and the room retries
      // loading per connection; a successful sync recovers the state.
      set('load_failed');
    } else if (ev.code === CLOSE_STORAGE_FAILURE) {
      // A storage failure: the board remains readable from storage, so this
      // is a plain transient drop (open pages re-send unsaved changes).
      if (reported === 'load_failed') return;
      set(everConnected ? 'reconnecting' : 'connecting');
    }
  };

  const onSyncEvent = (synced: boolean): void => {
    if (synced) onSynced();
  };

  provider.on('status', onStatus);
  provider.on('connection-close', onConnectionClose);
  provider.on('sync', onSyncEvent);

  return {
    destroy() {
      provider.off('status', onStatus);
      provider.off('connection-close', onConnectionClose);
      provider.off('sync', onSyncEvent);
      provider.destroy();
    },
    /**
     * Test helper: drop the live connection (simulates a Wi-Fi outage). Uses the
     * provider's disconnect() rather than ws.close() because the browser's close
     * handshake does not complete against the local workerd server (the socket
     * stalls in CLOSING and the `close` event never fires). disconnect() cleanly
     * tears down the socket, reports 'disconnected', and — crucially — keeps the
     * local Y.Doc intact so offline edits are preserved for the catch-up.
     */
    drop() {
      provider.disconnect();
    },
    /**
     * Test helper: resume the connection (simulates the network returning).
     * Re-establishes the socket and re-syncs, catching up any offline edits.
     */
    resume() {
      provider.connect();
    },
  };
}
