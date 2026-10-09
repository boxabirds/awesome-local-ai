import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { ROOM_PATH_PREFIX } from '../../shared/protocol';

/**
 * What the connection is doing, in the order a session meets them: the first load, a
 * live board, an outage, and the moment the board is live again.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  /** Detach from the document: on unmount, or when this page moves to another board. */
  destroy(): void;
}

/**
 * The server half of the provider address. `y-websocket` joins it with the room name
 * using a `/`, and the room name is the board id, so this ends up as
 * `<scheme>://<host>/api/rooms/<boardId>` — the address `src/worker/index.ts` routes to
 * that board's room.
 */
export function boardRoomServerUrl(origin: string = window.location.origin): string {
  return `${origin.replace(/^http/, 'ws')}${ROOM_PATH_PREFIX}`.replace(/\/$/, '');
}

/**
 * Put `doc` on the wire for one board and report what the connection is doing.
 *
 * There is no reconnection logic here: `y-websocket` retries with exponential backoff
 * (capped at `RECONNECT_MAX_BACKOFF_MS`) and the board stays editable throughout,
 * because edits go into the local document either way. What this function adds is the
 * distinction the badge cares about — before the first sync nobody knows yet whether
 * this is a slow start or a broken address, so it says 'connecting'; after a connection
 * that was actually working has been lost, it says 'reconnecting'; and when that
 * connection is back and synced, it is `confirmed` for `CONNECTED_CONFIRMATION_MS`
 * before going quiet again, so the reassurance is shown and then gets out of the way.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(boardRoomServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    // Two tabs of the same board talk to the room like any two people would: no
    // side channel that a second browser would not have.
    disableBc: true,
  });

  let state: ConnectionState = 'connecting';
  let confirmation: ReturnType<typeof setTimeout> | null = null;
  const publish = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const clearConfirmation = (): void => {
    if (confirmation === null) return;
    clearTimeout(confirmation);
    confirmation = null;
  };

  const onStatus = ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }): void => {
    if (status !== 'disconnected') return;
    // A socket that never got anywhere is still the first load, not an outage.
    if (state !== 'connecting') publish('reconnecting');
  };
  const onSync = (synced: boolean): void => {
    if (!synced) return;
    if (state === 'connecting') publish('connected');
    if (state === 'reconnecting') {
      publish('confirmed');
      clearConfirmation();
      confirmation = setTimeout(() => publish('connected'), CONNECTED_CONFIRMATION_MS);
    }
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  return {
    destroy(): void {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      clearConfirmation();
      provider.destroy();
    },
  };
}
