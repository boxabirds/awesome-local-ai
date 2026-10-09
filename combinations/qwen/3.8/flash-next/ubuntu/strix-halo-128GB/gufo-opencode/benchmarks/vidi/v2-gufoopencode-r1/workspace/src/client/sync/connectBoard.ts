import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  destroy(): void;
  // Test builds only (wired through window.__vidi6): tears the socket down
  // for the given duration and reconnects afterwards, standing in for a
  // network outage. Playwright's context.setOffline(true) does not drop an
  // already-established WebSocket, so the outage has to be injected at the
  // provider boundary for the Flaky Wi-Fi workflow to be testable.
  simulateOutage?(ms: number): void;
}

// The provider URL is same-origin with the page: http becomes ws and https
// becomes wss, pointing at the Worker's /api/rooms namespace.
function roomsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/rooms`;
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void
): BoardConnection {
  const provider = new WebsocketProvider(roomsUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Same-browser tabs must not sync around the server: every change has to
    // take the same path a real second person's change takes.
    disableBc: true
  });

  let state: ConnectionState = 'connecting';
  let everConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (next: ConnectionState): void => {
    state = next;
    onState(next);
  };

  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const onStatus = (event: { status: 'connecting' | 'connected' | 'disconnected' }): void => {
    if (event.status === 'disconnected') {
      // Losing the socket only matters once one has been established; a first
      // load that has not connected yet is still just "Connecting…".
      clearConfirmation();
      if (everConnected && state !== 'reconnecting') emit('reconnecting');
      return;
    }
    if (event.status === 'connected') {
      everConnected = true;
      if (provider.synced) onSynced();
    }
  };

  const onSynced = (): void => {
    if (provider.synced === false) return;
    if (state === 'reconnecting') {
      // Flash green for CONNECTED_CONFIRMATION_MS before hiding.
      clearConfirmation();
      emit('confirmed');
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        if (state === 'confirmed') emit('connected');
      }, CONNECTED_CONFIRMATION_MS);
      return;
    }
    if (state === 'connecting') emit('connected');
  };

  const onProviderSync = (synced: boolean): void => {
    if (synced) onSynced();
  };

  const onConnectionClose = (): void => {
    clearConfirmation();
    if (everConnected && state !== 'reconnecting') emit('reconnecting');
  };

  provider.on('status', onStatus);
  provider.on('sync', onProviderSync);
  // A websocket that opened but never synced (e.g. an unreachable worker) also
  // needs the reconnecting/confirmed cycle once connectivity flaps.
  provider.on('connection-close', onConnectionClose);

  if (provider.wsconnected && provider.synced) {
    everConnected = true;
    emit('connected');
  }

  return {
    destroy() {
      clearConfirmation();
      provider.off('status', onStatus);
      provider.off('sync', onProviderSync);
      provider.off('connection-close', onConnectionClose);
      provider.destroy();
    },
    simulateOutage(ms: number) {
      provider.disconnect();
      setTimeout(() => provider.connect(), ms);
    }
  };
}
