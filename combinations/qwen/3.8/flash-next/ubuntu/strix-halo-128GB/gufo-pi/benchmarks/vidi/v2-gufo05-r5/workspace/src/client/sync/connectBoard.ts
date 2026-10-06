/**
 * The client half of the live connection (story 3).
 *
 * `connectBoard` owns the y-websocket provider for one board and turns what the provider
 * reports - the socket status and whether the document has synced - into the four states the
 * badge renders. The rules are the design's state machine:
 *
 * ```text
 *   connecting     before the first sync, and while a first connection is being retried
 *   connected      the socket is open and the board is in sync (nothing shown)
 *   reconnecting   the connection dropped after the board had been live
 *   confirmed      just back after a drop; held for CONNECTED_CONFIRMATION_MS, then hidden
 * ```
 *
 * The provider does the re connecting: it retries with exponential backoff up to
 * `maxBackoffTime` on its own, so this file only reports what it sees.
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import {
  CONNECTED_CONFIRMATION_MS,
  CONNECTION_IDLE_TIMEOUT_MS,
  RECONNECT_MAX_BACKOFF_MS,
  RESYNC_INTERVAL_MS,
} from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export interface BoardConnection {
  /** Closes the connection and stops the provider listening to the document. */
  destroy(): void;
}

export interface ConnectBoardOptions {
  /**
   * The WebSocket class the provider uses. Normally the browser's own; the component tests
   * hand in a scripted socket so the badge can be driven through a whole outage without a
   * server to talk to. Everything above the socket - the provider, y-protocols, Yjs - stays real.
   */
  webSocket?: typeof WebSocket;
  /**
   * How long a live socket may stay silent before the connection is called lost. Only the
   * component tests change it, because they drive the clock; the app uses
   * `CONNECTION_IDLE_TIMEOUT_MS`.
   */
  idleTimeoutMs?: number;
}

/**
 * A `WebSocket` class that reports a silent connection as idle.
 *
 * A browser whose network disappeared does not notice on its own: the socket simply stops
 * carrying frames, and y-websocket's own silence timeout is 30 s and hard-coded. The room answers
 * every SyncStep1, and a tab sends one every `RESYNC_INTERVAL_MS`, so a socket that carried
 * nothing for `idleMs` has no working connection behind it. `onIdle` is called once per socket,
 * which is what makes the badge answer within seconds of an outage rather than half a minute
 * later; the provider's backoff does the retrying and the next sync picks up whatever the board
 * changed meanwhile.
 *
 * Exported for the component tests, which wrap the scripted socket and drive the clock.
 */
export function webSocketWithIdleTimeout(
  base: typeof WebSocket,
  idleMs: number,
  onIdle: () => void,
): typeof WebSocket {
  const checkEveryMs = Math.max(500, Math.floor(idleMs / 4));
  return class IdleWatchedWebSocket extends base {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      let lastFrame = Date.now();
      let notified = false;
      this.addEventListener('message', () => {
        lastFrame = Date.now();
      });
      const stopWatching = () => clearInterval(timer);
      const timer = setInterval(() => {
        if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) {
          stopWatching();
        } else if (Date.now() - lastFrame > idleMs && !notified) {
          notified = true;
          stopWatching();
          onIdle();
        }
      }, checkEveryMs);
      this.addEventListener('close', stopWatching);
    }
  };
}

/** Where rooms live: the same origin the page came from, under `/api/rooms`. */
function roomServerUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/api/rooms`;
}

/**
 * Connects `doc` to the room for `boardId` and reports every state change to `onState`.
 * The first report is the state the connection starts in; after that only real transitions
 * are reported, so the caller never sees the same state twice in a row.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): BoardConnection {
  const idleTimeoutMs = options.idleTimeoutMs ?? CONNECTION_IDLE_TIMEOUT_MS;
  // The socket watch has to reach the provider, and it only ever fires after the provider
  // exists, so the reference is filled in right below.
  let restartConnection = (): void => {};
  const provider = new WebsocketProvider(roomServerUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
    // A board nobody is editing must not look like a dead connection, so every tab asks the room
    // for anything it is missing regularly - and the room's answer is what the socket watch
    // below counts as a live wire.
    resyncInterval: RESYNC_INTERVAL_MS,
    // the browser's own socket, watched for silence; tests hand in their own
    WebSocketPolyfill: webSocketWithIdleTimeout(
      options.webSocket ?? globalThis.WebSocket,
      idleTimeoutMs,
      () => restartConnection(),
    ),
  });

  // Dropping the connection through the provider - not by closing the socket - is what reports
  // it. A socket whose network vanished silently is still OPEN, and `close()` would wait for a
  // close frame from a room that cannot be reached, so nothing would ever happen.
  restartConnection = (): void => {
    provider.disconnect();
    provider.connect();
  };

  let state: ConnectionState = 'connecting';
  /** Whether this board has ever been live; everything after that first sync is a reconnect. */
  let hadBeenLive = false;
  /** Set while the connection is down, so the next sync is a return and gets confirmed. */
  let awaitingReturn = false;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const clearConfirmation = (): void => {
    if (confirmTimer !== undefined) {
      clearTimeout(confirmTimer);
      confirmTimer = undefined;
    }
  };

  const publish = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    onState(next);
  };

  /** Reads the provider and publishes the state that follows from it. */
  const evaluate = (): void => {
    const live = provider.wsconnected && provider.synced;
    if (live) {
      if (!hadBeenLive) {
        hadBeenLive = true;
        awaitingReturn = false;
        clearConfirmation();
        publish('connected');
        return;
      }
      if (awaitingReturn) {
        awaitingReturn = false;
        publish('confirmed');
        clearConfirmation();
        confirmTimer = setTimeout(() => {
          confirmTimer = undefined;
          publish('connected');
        }, CONNECTED_CONFIRMATION_MS);
      }
      return;
    }
    // a confirmation that is still counting down is off: the link dropped again first
    clearConfirmation();
    if (hadBeenLive) awaitingReturn = true;
    publish(hadBeenLive ? 'reconnecting' : 'connecting');
  };

  const onStatus = (): void => evaluate();
  const onSync = (): void => evaluate();

  // The browser knows about a dead network long before the socket does: while the page is
  // offline nothing is exchanged, and y-websocket only gives up after its 30 s of silence.
  // Dropping the connection on `offline` is what makes the badge answer straight away, and
  // reconnecting on `online` avoids waiting for the backoff timer of the last failed attempt.
  const onBrowserOffline = (): void => provider.disconnect();
  const onBrowserOnline = (): void => provider.connect();
  window.addEventListener('offline', onBrowserOffline);
  window.addEventListener('online', onBrowserOnline);

  provider.on('status', onStatus);
  provider.on('sync', onSync);
  // Report the starting state unconditionally: a caller that reuses this hook for another
  // board has to be told the connection started over, even though the state is still
  // "connecting" as far as this connection is concerned.
  onState(state);
  evaluate();

  return {
    destroy() {
      clearConfirmation();
      window.removeEventListener('offline', onBrowserOffline);
      window.removeEventListener('online', onBrowserOnline);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
    },
  };
}
