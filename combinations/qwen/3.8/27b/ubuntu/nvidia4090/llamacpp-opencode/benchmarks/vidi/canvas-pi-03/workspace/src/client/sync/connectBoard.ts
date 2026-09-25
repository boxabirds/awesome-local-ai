import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS } from '@/shared/config';

/**
 * Client connection state (story 3). Drives the status badge and the
 * `window.__vidi6.connectionState` test hook.
 *
 *  - 'connecting'   first connection in progress (never been connected yet)
 *  - 'connected'    first connection open and synced (stable)
 *  - 'reconnecting' a previously-connected socket dropped; retrying
 *  - 'confirmed'    a reconnection is open and synced; the badge shows
 *                   "Connected" for CONNECTED_CONFIRMATION_MS, then hides
 *
 * The confirmed -> hidden transition is owned by the ConnectionStatus
 * component (so it can be driven by fake timers in the component test);
 * connectBoard only reports which of the four states we are in.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

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

  // The provider reports 'connected' when the socket opens, but we only
  // surface "connected/confirmed" once the doc is actually synced.
  const onSynced = () => {
    if (!provider.synced) return;
    if (everConnected) {
      onState('confirmed');
    } else {
      everConnected = true;
      onState('connected');
    }
  };

  const onStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    if (status === 'connected') {
      onSynced();
    } else if (status === 'disconnected') {
      if (everConnected) onState('reconnecting');
    } else {
      // 'connecting'
      onState(everConnected ? 'reconnecting' : 'connecting');
    }
  };

  provider.on('status', onStatus);
  provider.on('sync', (synced: boolean) => {
    if (synced) onSynced();
  });

  return {
    destroy() {
      provider.off('status', onStatus);
      provider.off('sync', onSynced);
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
