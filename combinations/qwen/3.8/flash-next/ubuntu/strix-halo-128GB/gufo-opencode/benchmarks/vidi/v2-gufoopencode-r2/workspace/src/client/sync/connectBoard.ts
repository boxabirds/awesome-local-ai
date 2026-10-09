// Connects the page's Y.Doc to its BoardRoom over y-websocket and derives the
// badge's ConnectionState from the provider's status/sync events.

import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

export interface BoardConnection {
  destroy(): void;
}

interface StateMapper {
  onStatus(status: string): void;
  onSync(synced: boolean): void;
  onClose(code: number): void;
  dispose(): void;
}

// The state machine kept separate from WebsocketProvider so component tests
// drive it with fake timers and hand-fed events. Rules (sync.client):
// - first sync(true)            → connected
// - disconnected after having synced → reconnecting (never before)
// - later sync(true)            → confirmed for CONNECTED_CONFIRMATION_MS,
//                                 then connected; another disconnect during
//                                 the confirmation window returns to
//                                 reconnecting immediately.
export function createConnectionStateMapper(
  emit: (state: ConnectionState) => void,
): StateMapper {
  let hadSynced = false;
  let loadFailed = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConfirmTimer = () => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  return {
    onStatus(status) {
      if (loadFailed) return; // close-code mapping owns this state
      if (status === 'disconnected' && hadSynced) {
        clearConfirmTimer();
        emit('reconnecting');
      }
    },
    onSync(synced) {
      if (!synced) return;
      clearConfirmTimer();
      if (loadFailed) {
        loadFailed = false;
        hadSynced = true;
        emit('connected');
        return;
      }
      if (!hadSynced) {
        hadSynced = true;
        emit('connected');
        return;
      }
      emit('confirmed');
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        emit('connected');
      }, CONNECTED_CONFIRMATION_MS);
    },
    onClose(code) {
      if (code === CLOSE_BOARD_LOAD_FAILED) {
        clearConfirmTimer();
        loadFailed = true;
        emit('load_failed');
        return;
      }
      // Normal closure on teardown must not show a badge.
      if (code === 1000 || code === 1001 || code === 1005) return;
      if (loadFailed) return; // still unreadable; stay load_failed until a sync
      if (hadSynced) {
        clearConfirmTimer();
        emit('reconnecting');
      }
    },
    dispose: clearConfirmTimer,
  };
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(
    `${scheme}://${window.location.host}/api/rooms`,
    boardId,
    doc,
    // BroadcastChannel off: two tabs of the same browser must sync through
    // the server like any two participants.
    { maxBackoffTime: RECONNECT_MAX_BACKOFF_MS, disableBc: true },
  );

  const mapper = createConnectionStateMapper(onState);
  provider.on('status', ({ status }: { status: string }) => mapper.onStatus(status));
  provider.on('sync', (synced: boolean) => mapper.onSync(synced));
  provider.on('connection-close', (event: CloseEvent | null) =>
    mapper.onClose(event?.code ?? 1006),
  );
  // Non-null local awareness state makes y-websocket send periodic awareness
  // renewals; the room relays awareness back, so idle connections keep
  // seeing traffic and never hit messageReconnectTimeout.
  provider.awareness.setLocalState({});

  return {
    destroy() {
      provider.awareness.setLocalState(null);
      mapper.dispose();
      provider.destroy();
    },
  };
}
