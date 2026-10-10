import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS
} from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

// Connection state machine from the story design: Connecting → Connected,
// and after any outage Reconnecting → Confirmed (green badge) → Connected.
// A room that refuses to load (close 4500) is a distinct LoadFailed state:
// the board must never be shown as an empty editable board (persist.load_failure).
export type SyncStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

// Design-facing alias.
export type ConnectionState = SyncStatus;

export interface SyncStatusMachine {
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  // Feed provider lifecycle events into the machine.
  providerStatus(status: 'connecting' | 'connected' | 'disconnected'): void;
  // A provider close event: 4500 marks the board load-failed; every other
  // code (1011 storage failure, 1003 bad data, network) is a retry.
  close(code: number): void;
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
      // A load-failed board stays red and disabled through the provider's
      // backoff retries; only a successful sync (below) leaves the state.
      if (current === 'load_failed') return;
      if (status === 'disconnected') {
        clearConfirmation();
        // First connection attempt still reads as "Connecting…".
        setStatus(everSynced ? 'reconnecting' : 'connecting');
      } else if (status === 'connecting') {
        if (!everSynced) setStatus('connecting');
      }
      // 'connected' waits for the synced event: open socket is not synced.
    },
    close(code) {
      if (code === CLOSE_BOARD_LOAD_FAILED) {
        clearConfirmation();
        setStatus('load_failed');
      }
      // Other close codes surface as reconnecting via providerStatus.
    },
    synced(isSynced) {
      if (!isSynced) {
        clearConfirmation();
        if (current !== 'load_failed' && everSynced) setStatus('reconnecting');
        return;
      }
      // First successful sync proves the board loaded: leave any load-failed
      // state and re-enable editing without a page reload.
      if (!everSynced) {
        everSynced = true;
        setStatus('connected');
        return;
      }
      if (current === 'reconnecting' || current === 'connecting' || current === 'load_failed') {
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
  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event !== null) machine.close(event.code);
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
