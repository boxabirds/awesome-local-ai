/**
 * Client connection (design "sync.client").
 *
 * One `WebsocketProvider` per board per tab, pointed at the Worker route
 * `/api/rooms/:boardId`. BroadcastChannel is disabled on purpose: with it on,
 * two tabs of the same browser would sync around the server and the tests would
 * pass while the server path was broken.
 *
 * The provider reports two independent things — whether the socket is up
 * (`status`) and whether it has exchanged state (`sync`) — and the board needs
 * one state for the badge:
 *
 *   connecting  socket down or not synced yet, never synced before
 *   connected   socket open and synced
 *   reconnecting socket was open and synced, then went away
 *   confirmed   back up and synced again; shown for CONNECTED_CONFIRMATION_MS
 *               before the badge disappears
 *
 * Nothing here touches the document beyond what the provider itself does, and
 * nothing is written about selection or editing (those stay local state).
 */

import { WebsocketProvider } from 'y-websocket';
import type { Doc } from 'yjs';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/** What the badge shows; `connected` means "no badge". */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  /** Close the socket and stop listening; called on unmount or board change. */
  destroy(): void;
}

/** WebSocket root for the room API, on the origin the page was served from. */
export function roomApiRoot(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/rooms`;
}

export function connectBoard(
  doc: Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomApiRoot(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let state: ConnectionState = 'connecting';
  let everSynced = false;
  let destroyed = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: ConnectionState): void => {
    if (destroyed || next === state) return;
    state = next;
    onState(next);
  };

  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }
  };

  const onStatus = ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }): void => {
    if (status === 'disconnected') {
      // Only ever emitted after a connection that was up, so this is a loss of
      // a board that used to be live. The board stays fully editable: this is a
      // badge, not a lock.
      clearConfirmation();
      publish('reconnecting');
    } else if (!everSynced) {
      // First attempt (or a retry of it): still "Connecting…".
      publish('connecting');
    }
  };

  const onSync = (synced: boolean): void => {
    if (!synced) return;
    if (!everSynced) {
      everSynced = true;
      publish('connected');
      return;
    }
    // Back up after an outage: green confirmation, then hide the badge.
    clearConfirmation();
    publish('confirmed');
    confirmationTimer = setTimeout(() => {
      confirmationTimer = null;
      publish('connected');
    }, CONNECTED_CONFIRMATION_MS);
  };

  provider.on('status', onStatus);
  provider.on('sync', onSync);

  return {
    destroy(): void {
      destroyed = true;
      clearConfirmation();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
