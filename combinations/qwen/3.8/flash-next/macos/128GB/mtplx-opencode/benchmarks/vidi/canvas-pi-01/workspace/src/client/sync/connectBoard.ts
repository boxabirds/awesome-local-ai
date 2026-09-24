/**
 * Story 3 · client connection (design "Client connection and status").
 *
 * Wraps the `y-websocket` `WebsocketProvider` and translates its `status`,
 * `sync` and `connection-close` events into the UI's `ConnectionState` via the
 * pure `createConnectionMachine`. Kept separate from React so a browser tab
 * (and the e2e tests) drive the real provider while the component tests drive a
 * fake one through the same machine.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
  boardWsServer,
} from '../../shared/config';
import {
  createConnectionMachine,
  type ConnectionState,
  type ProviderStatus,
} from './connectionState';

export interface BoardConnection {
  /** Tear the provider down (on unmount / board change). Idempotent. */
  destroy(): void;
}

/**
 * Connect `doc` to `boardId`'s room. `onState` is called with the initial
 * `connecting` state and again on every transition, so the badge can mirror it
 * and the app can expose it for the nightly e2e assertions.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  onState('connecting');

  const machine = createConnectionMachine({
    onState,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer),
    confirmationMs: CONNECTED_CONFIRMATION_MS,
  });

  // `disableBc` so same-browser tabs cannot sync around the server (design
  // "Why these choices"); `maxBackoffTime` from the named setting. The provider
  // joins `serverUrl + '/' + room`, so `boardWsServer` is passed without the
  // trailing slash and `boardId` as the room name (design "Client connection").
  const provider = new WebsocketProvider(boardWsServer(boardId), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
    params: {},
  });

  // The provider `emit`s its argument list spread into the handler
  // (`lib0/observable`: `f(...args)`): `status` passes `{ status }` and `sync`
  // passes the boolean directly, so the handlers take those shapes directly.
  const onProviderStatus = (event: { status: ProviderStatus }): void => {
    machine.status(event.status);
  };
  const onProviderSync = (isSynced: boolean): void => {
    machine.sync(isSynced);
  };
  // The close code is the only place the room's honest failure (4500) shows up:
  // a board that could not be load is reported once, then the provider retries
  // with the same backoff as any other drop.
  const onConnectionClose = (event: { code: number } | null): void => {
    machine.close(event?.code ?? 1006);
  };

  provider.on('status', onProviderStatus);
  provider.on('sync', onProviderSync);
  provider.on('connection-close', onConnectionClose);

  return {
    destroy(): void {
      provider.off('status', onProviderStatus);
      provider.off('sync', onProviderSync);
      provider.off('connection-close', onConnectionClose);
      provider.destroy();
    },
  };
}