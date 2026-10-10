import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS
} from '../../shared/config';

// Connection state machine from the story design: Connecting → Connected,
// and after any outage Reconnecting → Confirmed (green badge) → Connected.
export type SyncStatus = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface SyncStatusMachine {
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  // Feed provider lifecycle events into the machine.
  providerStatus(status: 'connecting' | 'connected' | 'disconnected'): void;
  synced(isSynced: boolean): void;
  dispose(): void;
}

// Pure state machine (no provider) so component tests can drive it directly
// with fake timers.
export function createSyncStatusMachine(): SyncStatusMachine {
  let current: SyncStatus = 'connecting';
  let everSynced = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(status: SyncStatus) => void>();

  const setStatus = (next: SyncStatus): void => {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener(next);
  };
  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  return {
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    providerStatus(status) {
      if (status === 'disconnected') {
        clearConfirmation();
        // First connection attempt still reads as "Connecting…".
        setStatus(everSynced ? 'reconnecting' : 'connecting');
      } else if (status === 'connecting') {
        if (!everSynced) setStatus('connecting');
      }
      // 'connected' waits for the synced event: open socket is not synced.
    },
    synced(isSynced) {
      if (!isSynced) {
        clearConfirmation();
        if (everSynced) setStatus('reconnecting');
        return;
      }
      if (!everSynced) {
        everSynced = true;
        setStatus('connected');
        return;
      }
      if (current === 'reconnecting' || current === 'connecting') {
        setStatus('confirmed');
        clearConfirmation();
        confirmationTimer = setTimeout(() => {
          confirmationTimer = null;
          setStatus('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
    },
    dispose() {
      clearConfirmation();
      listeners.clear();
    }
  };
}

export interface BoardConnection {
  readonly provider: WebsocketProvider;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  destroy(): void;
}

// Connects the page's Y.Doc to the board room over the Worker route.
// disableBc: tabs must sync through the server, never a local shortcut.
export function connectBoard(doc: Y.Doc, boardId: string): BoardConnection {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${wsProtocol}//${window.location.host}/api/rooms`;
  const provider = new WebsocketProvider(serverUrl, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true
  });
  const machine = createSyncStatusMachine();
  provider.on('status', (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    machine.providerStatus(event.status);
  });
  provider.on('sync', (isSynced: boolean) => {
    machine.synced(isSynced);
  });
  return {
    provider,
    status: machine.status,
    subscribe: machine.subscribe,
    destroy() {
      machine.dispose();
      provider.destroy();
    }
  };
}
