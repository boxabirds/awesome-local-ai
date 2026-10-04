import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/**
 * Connect a Y.Doc to a board room via y-websocket WebsocketProvider.
 * Maps provider status + sync events to a simplified ConnectionState.
 *
 * Returns a destroy() function that disconnects and cleans up.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  // Determine ws origin from current page
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsOrigin = `${proto}//${window.location.host}`;

  // y-websocket builds the URL as `serverUrl + '/' + roomName`, so the roomName
  // must NOT carry a leading slash (that would produce a double slash and a
  // failing 307 handshake).
  const provider = new WebsocketProvider(wsOrigin, `api/rooms/${boardId}`, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let currentState: ConnectionState = 'connecting';
  // The close code of the most recent socket close, so we can tell a
  // load-failed close (4500) apart from a storage/network close (1011/1003/...).
  let lastCloseCode: number | null = null;

  function setState(s: ConnectionState) {
    if (currentState === s) return;
    currentState = s;
    onState(s);
  }

  function handleSync() {
    const connected = provider.wsconnected;
    const synced = provider.synced;

    if (connected && synced) {
      // A successful (re)connection clears any prior load-failed close code.
      lastCloseCode = null;
      if (currentState === 'load_failed') {
        // The board loaded (after retries): recover without a page reload.
        hasConnected = true;
        setState('connected');
      } else if (hasConnected) {
        // Reconnected after being disconnected
        setState('confirmed');
        if (confirmationTimer) clearTimeout(confirmationTimer);
        confirmationTimer = setTimeout(() => {
          setState('connected');
          confirmationTimer = null;
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        hasConnected = true;
        setState('connected');
      }
    } else {
      if (confirmationTimer) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
      }
      // A 4500 close means the board's saved state could not be loaded. Other
      // close codes (storage 1011, unsupported 1003, network) are transient:
      // the board is readable and changes are retried on reconnection.
      if (lastCloseCode === CLOSE_BOARD_LOAD_FAILED) {
        setState('load_failed');
      } else if (hasConnected) {
        setState('reconnecting');
      } else {
        setState('connecting');
      }
    }
  }

  const statusHandler = () => handleSync();
  const syncHandler = () => handleSync();
  // The provider emits `connection-close` with the CloseEvent whenever a socket
  // closes. This is the reliable place to learn the close code: a LoadFailed
  // room closes the socket *before* the sync completes, so we cannot wait for
  // the connected+synced branch to observe it.
  const closeHandler = (event: CloseEvent | null) => {
    lastCloseCode = event ? event.code : null;
    handleSync();
  };

  provider.on('status', statusHandler);
  provider.on('sync', syncHandler);
  provider.on('connection-close', closeHandler);

  // Initial state
  setState('connecting');

  return {
    destroy() {
      if (confirmationTimer) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
      }
      provider.off('status', statusHandler);
      provider.off('sync', syncHandler);
      provider.off('connection-close', closeHandler);
      provider.destroy();
    },
  };
}
