import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/**
 * Editing is allowed in every state except 'load_failed': a board that
 * cannot be loaded must not be edited (changes could not be stored), while a
 * transient disconnect keeps the board readable and editable (unsaved
 * changes are re-sent on reconnect).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * Creates a y-websocket WebsocketProvider for the given doc and boardId.
 * Maps provider status to our ConnectionState and calls onState on changes.
 *
 * State mapping:
 * - provider 'connecting' before first sync → 'connecting'
 * - provider 'connected' + sync(true) → 'connected'
 * - 'disconnected' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS then 'connected'
 * - close code CLOSE_BOARD_LOAD_FAILED (4500) → 'load_failed'; the first
 *   successful (re)sync afterwards → 'connected' (recovered, no reload)
 *
 * Returns { destroy() } for cleanup on unmount.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/api/rooms`;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let currentState: ConnectionState = 'connecting';
  let hasConnected = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(s: ConnectionState) {
    if (currentState === s) return;
    currentState = s;
    onState(s);
  }

  const statusHandler = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    const status = event.status;

    if (status === 'connected') {
      if (!hasConnected) {
        hasConnected = true;
        setState('connected');
      } else if (currentState === 'reconnecting') {
        // Reconnected after being disconnected
        setState('confirmed');
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          setState('connected');
          confirmTimer = null;
        }, CONNECTED_CONFIRMATION_MS);
      }
    } else if (status === 'disconnected' && hasConnected) {
      // Was connected, now disconnected. 'load_failed' is owned by the
      // connection-close handler (4500) and must not be downgraded here.
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      if (currentState !== 'load_failed') {
        setState('reconnecting');
      }
    }
    // 'connecting' before first sync stays as 'connecting'
  };

  const closeHandler = (event: CloseEvent | null) => {
    // 4500: the room could not load the board from storage. Show the honest
    // failure state; the provider keeps retrying in the background (4500 is
    // outside y-websocket's 4400–4499 "permanent" range, so it reconnects).
    // 1011 (storage failure) and any other code → 'reconnecting' (handled by
    // the status handler): the board is readable and changes are re-sent on
    // reconnect.
    if (event?.code === CLOSE_BOARD_LOAD_FAILED) {
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      setState('load_failed');
    }
  };

  const syncHandler = (state: boolean) => {
    // First successful (re)sync after a load failure: the board is back.
    // Editing is re-enabled without a page reload (the provider keeps
    // retrying in the background with the story-3 backoff).
    if (state && currentState === 'load_failed') {
      setState('connected');
    }
  };

  provider.on('status', statusHandler);
  provider.on('connection-close', closeHandler);
  provider.on('sync', syncHandler);

  // Initial state
  onState('connecting');

  return {
    destroy() {
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.off('status', statusHandler);
      provider.off('connection-close', closeHandler);
      provider.off('sync', syncHandler);
      provider.destroy();
    },
  };
}
