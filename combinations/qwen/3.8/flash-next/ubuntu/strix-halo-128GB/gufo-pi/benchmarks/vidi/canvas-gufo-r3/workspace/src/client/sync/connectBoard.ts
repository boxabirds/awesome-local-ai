import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '@shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/**
 * Pure state machine mapping y-websocket `status` + `sync` events onto the four
 * UI states in the design's state diagram:
 *
 *   Connecting ──(first sync)──> Connected
 *   Connected  ──(socket closed)──> Reconnecting
 *   Reconnecting ──(socket open + synced)──> Confirmed ──(CONNECTED_CONFIRMATION_MS)──> Connected
 *
 * Exposed separately from `connectBoard` so the badge can be tested with a fake
 * provider and fake timers (TC-19 to TC-21).
 */
export interface ConnectionStateController {
  handleStatus(status: 'connecting' | 'connected' | 'disconnected'): void;
  handleSync(synced: boolean): void;
  destroy(): void;
}

export function createConnectionState(
  onState: (s: ConnectionState) => void,
  confirmationMs: number = CONNECTED_CONFIRMATION_MS,
): ConnectionStateController {
  let everSynced = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmation = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  return {
    handleStatus(status) {
      if (status === 'connecting') {
        // A fresh attempt after we have already been connected keeps the
        // "Reconnecting…" badge up rather than flashing "Connecting…" again.
        if (!everSynced) onState('connecting');
      } else if (status === 'connected') {
        // Wait for the first sync before declaring the connection usable.
      } else if (status === 'disconnected') {
        clearConfirmation();
        // Only show "Reconnecting…" once we had a working connection; a first-ever
        // failed attempt stays in the "Connecting…" state.
        if (everSynced) onState('reconnecting');
      }
    },
    handleSync(synced) {
      if (!synced) return;
      if (!everSynced) {
        everSynced = true;
        onState('connected');
        return;
      }
      // Reconnected after having synced before: show the green confirmation for a
      // short window, then settle back to the hidden "connected" state.
      onState('confirmed');
      clearConfirmation();
      confirmationTimer = setTimeout(() => {
        confirmationTimer = null;
        onState('connected');
      }, confirmationMs);
    },
    destroy() {
      clearConfirmation();
    },
  };
}

export interface BoardConnection {
  provider: WebsocketProvider;
  destroy(): void;
}

/** ws(s) origin for the room websocket, mirroring the page's scheme. */
function roomServerUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/rooms`;
}

/**
 * Attach a WebsocketProvider to `doc` for `boardId` and drive `onState` with the
 * mapped connection state. BroadcastChannel is disabled so two tabs of the same
 * browser cannot sync around the server (that would make the tests pass while the
 * server path is broken).
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const controller = createConnectionState(onState);
  onState('connecting');

  const statusHandler = ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) =>
    controller.handleStatus(status);
  const syncHandler = (synced: boolean) => controller.handleSync(synced);

  provider.on('status', statusHandler);
  provider.on('sync', syncHandler);
  if (provider.synced) controller.handleSync(true);

  return {
    provider,
    destroy() {
      controller.destroy();
      provider.off('status', statusHandler);
      provider.off('sync', syncHandler);
      provider.destroy();
    },
  };
}
