import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * Creates a y-websocket WebsocketProvider for the given doc and boardId.
 * Maps provider status to our ConnectionState and calls onState on changes.
 *
 * State mapping:
 * - provider 'connecting' before first sync → 'connecting'
 * - provider 'connected' + sync(true) → 'connected'
 * - 'disconnected' after having connected → 'reconnecting'
 * - reconnect after 'reconnecting' → 'confirmed' for CONNECTED_CONFIRMATION_MS then 'connected'
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
      // Was connected, now disconnected
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      setState('reconnecting');
    }
    // 'connecting' before first sync stays as 'connecting'
  };

  provider.on('status', statusHandler);

  // Initial state
  onState('connecting');

  return {
    destroy() {
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        confirmTimer = null;
      }
      provider.off('status', statusHandler);
      provider.destroy();
    },
  };
}
