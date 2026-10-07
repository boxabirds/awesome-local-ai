// connectBoard (stories 3+4): creates a y-websocket WebsocketProvider for
// the board and maps its status/sync/close events to our ConnectionState.
//
// Story 4 adds `load_failed`: the room closes a socket with
// CLOSE_BOARD_LOAD_FAILED (4500) while the board's storage cannot be loaded.
// The provider keeps retrying with story 3's backoff; the first successful
// sync after a 4500 switches back to `connected` (editing re-enabled) without
// a page reload. Close 1011 (storage failure) and 1003 (unsupported data) map
// to `reconnecting`, not `load_failed`: the board is readable and any unsaved
// local changes are re-sent on reconnection.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

interface ConnectBoardResult {
  destroy(): void;
}

/**
 * Connect a Y.Doc to a board room via the y-websocket provider.
 *
 * State mapping:
 * - provider 'connecting' (never connected) → 'connecting'
 * - provider 'connected' + sync(true) → 'connected' (first time)
 * - provider 'disconnected' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS → 'connected'
 * - close code 4500 (board load failed) → 'load_failed' (until the next sync)
 * - close code 1011/1003/other → 'reconnecting'
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): ConnectBoardResult {
  const wsOrigin = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.host;

  const provider = new WebsocketProvider(
    `${wsOrigin}//${wsHost}/api/rooms`,
    boardId,
    doc,
    {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
    },
  );

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let currentState: ConnectionState = 'connecting';

  function setState(s: ConnectionState) {
    if (currentState === s) return;
    currentState = s;
    onState(s);
  }

  function clearConfirmation() {
    if (confirmationTimer) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  }

  function showConfirmed() {
    setState('confirmed');
    clearConfirmation();
    confirmationTimer = setTimeout(() => {
      confirmationTimer = null;
      setState('connected');
    }, CONNECTED_CONFIRMATION_MS);
  }

  function handleStatus(event: { status: string }) {
    // While the board cannot be loaded, retry 'connecting'/'disconnected'
    // events must not flicker the red badge: only a successful sync (→
    // connected) or a non-4500 close (→ reconnecting) leaves `load_failed`.
    if (currentState === 'load_failed') return;
    if (event.status === 'connected') {
      // Socket is open; sync state will be confirmed via the 'sync' event
    } else if (event.status === 'disconnected' || event.status === 'connecting') {
      if (hasConnected) {
        clearConfirmation();
        setState('reconnecting');
      } else {
        setState('connecting');
      }
    }
  }

  /**
   * Server close codes (story 4). `event` is null for local closes
   * (destroy/disconnect, watchdog) — those are covered by the status events.
   */
  function handleClose(event: CloseEvent | null) {
    if (event === null) return;
    if (event.code === CLOSE_BOARD_LOAD_FAILED) {
      clearConfirmation();
      setState('load_failed');
      return;
    }
    // 1011 (storage failure), 1003 (unsupported data), network drops: the
    // board is readable; editing stays enabled and unsaved changes are
    // re-sent on the next connection.
    clearConfirmation();
    setState('reconnecting');
  }

  function handleSync(isSynced: boolean) {
    if (isSynced && provider.wsconnected) {
      if (currentState === 'load_failed') {
        // The room's retry succeeded: the board loaded. Editing is
        // re-enabled without a page reload.
        hasConnected = true;
        setState('connected');
        return;
      }
      if (hasConnected && currentState === 'reconnecting') {
        // Reconnected: show 'confirmed' then transition to 'connected'
        showConfirmed();
      } else {
        hasConnected = true;
        setState('connected');
      }
    }
  }

  provider.on('status', handleStatus);
  provider.on('sync', handleSync);
  provider.on('connection-close', handleClose);

  return {
    destroy() {
      clearConfirmation();
      provider.destroy();
    },
  };
}
