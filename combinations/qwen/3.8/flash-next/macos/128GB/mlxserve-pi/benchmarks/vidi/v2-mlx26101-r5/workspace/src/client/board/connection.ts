/**
 * The client's side of live sync: one WebSocket provider per board, and the state
 * machine behind the badge.
 *
 * The provider is y-websocket's. It is handed the room collection `/api/rooms` as its
 * server and the board id as its room name, and joins them with a '/' — so the address it
 * dials is `/api/rooms/<boardId>`, which is what the Worker routes on. The path is the
 * authority on which room a client reaches.
 *
 * The badge state is deliberately not a mirror of the provider's status: a socket that
 * has just come back and gone again in half a second would flicker "Connected" in
 * between, which is worse than staying on "Reconnecting…". So after a connection has
 * once been established, coming back has to *hold* for `CONNECTED_CONFIRMATION_MS`
 * before the badge believes it.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_DIAL_TIMEOUT_MS,
  RECONNECT_MAX_BACKOFF_MS,
  ROOM_PATH_PREFIX,
  ROOM_RESYNC_INTERVAL_MS,
  ROOM_SILENCE_LIMIT_MS,
} from '../../shared/config';
import { boardIdentity, type BoardIdentity } from './identity';

/** Where the connection is, as the badge shows it. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

/** Everything the badge can show, including a link that is not a board at all. */
export type BoardStatus = ConnectionState | 'invalid-board';

/** What y-websocket reports on its `status` event. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * The provider, as this module uses it. `WebsocketProvider` satisfies it through
 * `wrapProvider`; a test can emit these events by hand instead of waiting for a
 * network that would not fail on schedule.
 */
export interface BoardProvider {
  onStatus(handler: (status: ProviderStatus) => void): void;
  offStatus(handler: (status: ProviderStatus) => void): void;
  onSync(handler: (synced: boolean) => void): void;
  offSync(handler: (synced: boolean) => void): void;
  /** The awareness to publish this client's identity on. */
  readonly awareness: { setLocalStateField(field: string, value: unknown): void } | null;
  /**
   * Drops a connection attempt that has been in flight for `maxMs` without either
   * completing or failing, so that the next attempt can start. The real provider closes
   * the socket and its own backoff dials again; a test can record the ask and do nothing.
   */
  abandonStalledDial?(maxMs: number): void;
  /**
   * Gives up on an established connection that has heard nothing for `silenceMs` and dials
   * again. The provider has this rule too, at 30 seconds of silence; a board that asks its
   * room something every few seconds can be bolder, because silence from a line that is being
   * asked questions every few seconds really does mean the line is gone.
   */
  abandonSilentLine?(silenceMs: number): void;
  /** Closes the socket and stops the provider's own timers. */
  destroy(): void;
}

/** What `connectBoard` returns. */
export interface BoardConnection {
  /** The state to show; the last one passed to the listener as well. */
  readonly state: ConnectionState;
  /** True once the room has been reached and the board is in sync with it. */
  readonly synced: boolean;
  /**
   * Every state this connection has been in, oldest first, repeats left out.
   *
   * A test that wants to know whether a connection ever dropped has to look while it is
   * down, which is the moment a sampling test misses. The list is kept as the states
   * happen, so the question can be asked afterwards: "did it ever say it was reconnecting
   * during those three quarters of an hour it sat doing nothing?"
   */
  statesSeen(): readonly ConnectionState[];
  /** Ends the connection, unsubscribes and stops every timer. Safe twice over. */
  destroy(): void;
}

export interface ConnectBoardOptions {
  /** Base URL of the room collection; defaults to this page's origin. */
  url?: string;
  /** Provider to drive; the real one is built when this is absent. */
  provider?: BoardProvider;
  /** How long a returned connection must hold before the badge calls it connected. */
  confirmationMs?: number;
  /** How long to wait for a connection attempt before abandoning it and dialing again. */
  dialTimeoutMs?: number;
  /** How long an established line may go unanswered before it is given up on. */
  silenceMs?: number;
  /** Who this client appears as on awareness; the local identity by default. */
  identity?: BoardIdentity;
}

/**
 * Where the rooms live: this page's origin, `wss:` over https and `ws:` otherwise, at
 * `/api/rooms`. y-websocket appends the room name to this as a path segment — which is
 * why the board id is handed to it as the room name and this is the collection, not the
 * room. Get it the other way round and the address comes out with the id twice.
 */
export function serverUrl(base?: string): string {
  const source =
    base ?? (typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  const url = new URL(source, 'http://localhost/');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = ROOM_PATH_PREFIX;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/**
 * The address a board's room is dialed at: `/api/rooms/<boardId>`, which is the path the
 * Worker routes on. The id is the last segment and there is nothing after it.
 */
export function roomUrl(boardId: string, base?: string): string {
  return `${serverUrl(base)}/${boardId}`;
}

/**
 * The provider this module talks to, wrapped around y-websocket's.
 *
 * The wrappers remember the function they registered: `off` has to be given the very
 * same function to remove it, and handing it a fresh closure would leak a listener on
 * every reconnect.
 */
function wrapProvider(provider: WebsocketProvider): BoardProvider {
  const statuses = new Map<(status: ProviderStatus) => void, (event: { status: ProviderStatus }) => void>();
  const syncs = new Map<(synced: boolean) => void, (synced: boolean) => void>();
  // The attempt currently in flight, and when it started. Keyed by the socket itself, so a
  // dial that fails quickly and dials again is not counted as one long attempt.
  let attempt: { socket: WebSocket; since: number } | null = null;
  // How long the board has been wanting a connection with none in flight.
  let waiting: number | null = null;
  // Ends whatever is in flight and starts a fresh attempt, using the provider's own API so
  // its state stays honest. `connect` after `disconnect` matters: `disconnect` stops the
  // trying, and a board that has given up on a line still intends to get back in.
  const retryNow = (): void => {
    provider.disconnect();
    provider.connect();
  };
  return {
    abandonStalledDial(maxMs) {
      const socket = provider.ws;
      if (socket === null) {
        // No attempt in flight. That is normal for a moment — the provider waits out its
        // backoff between tries — but every retry it makes is a *consequence of a close*, so
        // a retry that goes missing is never resumed by an event: nothing happened, so nothing
        // is going to happen, and the board sits saying "Reconnecting…" with nothing pending.
        // `connect` is how we ask for an attempt; it does nothing when one is already in
        // flight or the connection is up, so there is no harm in asking.
        if (provider.wsconnected || !provider.shouldConnect) {
          attempt = null;
          waiting = null;
          return;
        }
        if (waiting === null) {
          waiting = Date.now();
          return;
        }
        if (Date.now() - waiting < maxMs) return;
        waiting = null;
        attempt = null;
        console.info('[vidi6] nothing is trying to reach the room; asking it to try again');
        provider.connect();
        return;
      }
      waiting = null;
      // An attempt that has got nowhere: still dialing, or open and never given us the room's
      // state. Either way there is no change of the kind the provider reacts to coming.
      const goingNowhere =
        socket.readyState !== WebSocket.OPEN ? true : !provider.synced;
      if (!goingNowhere) {
        attempt = null;
        return;
      }
      if (attempt === null || attempt.socket !== socket) {
        attempt = { socket, since: Date.now() };
          return;
      }
      if (Date.now() - attempt.since < maxMs) return;
      // This attempt has been going on for `maxMs` without producing a synced board, and
      // nothing will ever make it produce one: the provider retries when a socket closes, and
      // this one is not going to close by itself; its keepalive only looks at connections that
      // were established and got quiet. So end the attempt, on the record and through the
      // provider's own API, and start another one.
      attempt = null;
      // Worth a line in the console: a person staring at "Reconnecting…" for tens of seconds
      // is usually a board that had one attempt go nowhere and is now making a fresh one.
      console.info('[vidi6] this attempt to reach the room went nowhere; trying again');
      retryNow();
    },
    abandonSilentLine(silenceMs) {
      const socket = provider.ws;
      // Only an established connection has something to go quiet. While a dial is in flight
      // the dial watchdog is the one that decides, and it is not to be second-guessed.
      if (socket === null || !provider.wsconnected) return;
      if (Date.now() - provider.wsLastMessageReceived < silenceMs) return;
      console.info('[vidi6] the room has stopped answering; reconnecting');
      // Not `socket.close()`: a line that is dead in the way this branch is called for never
      // delivers a close event, and this has to end whether or not one ever arrives.
      // `disconnect` puts the provider back into "dial again" synchronously.
      retryNow();
    },
    onStatus(handler) {
      const wrapped = (event: { status: ProviderStatus }): void => handler(event.status);
      statuses.set(handler, wrapped);
      provider.on('status', wrapped);
    },
    offStatus(handler) {
      const wrapped = statuses.get(handler);
      if (wrapped === undefined) return;
      provider.off('status', wrapped);
      statuses.delete(handler);
    },
    onSync(handler) {
      syncs.set(handler, handler);
      provider.on('sync', handler);
    },
    offSync(handler) {
      if (!syncs.has(handler)) return;
      provider.off('sync', handler);
      syncs.delete(handler);
    },
    awareness: provider.awareness,
    destroy: () => provider.destroy(),
  };
}

/**
 * Connects a document to a board and reports how the connection is doing.
 *
 * `onState` is called on every change, including the initial `connecting`, and never
 * with the same state twice in a row. The provider is created once per call: nothing
 * here re-creates it, so a re-render cannot drop the socket.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): BoardConnection {
  const confirmationMs = options.confirmationMs ?? CONNECTED_CONFIRMATION_MS;
  const dialTimeoutMs = options.dialTimeoutMs ?? RECONNECT_DIAL_TIMEOUT_MS;
  const silenceMs = options.silenceMs ?? ROOM_SILENCE_LIMIT_MS;
  const identity = options.identity ?? boardIdentity();

  const provider =
    options.provider ??
    wrapProvider(
      // The room name is the board id, and y-websocket puts it on the end of the address
      // it dials: `<origin>/api/rooms` + `/` + `<boardId>`.
      new WebsocketProvider(serverUrl(options.url), boardId, doc, {
        // A reconnect waits at most this long between tries (10 s, from config).
        maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
        // A board that nobody is touching still talks to its room every so often: the
        // keepalive would otherwise close an idle line and put "Reconnecting…" on a board
        // that has nothing wrong with it, and the exchange puts right anything that was
        // ever missed. See ROOM_RESYNC_INTERVAL_MS.
        resyncInterval: ROOM_RESYNC_INTERVAL_MS,
        // Two tabs in one browser must sync through the server like everybody else;
        // the BroadcastChannel would let them cheat past the room we are testing.
        disableBc: true,
      }),
    );

  let state: ConnectionState = 'connecting';
  let everConnected = false;
  let synced = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const statesSeen: ConnectionState[] = [];

  const publish = (next: ConnectionState): void => {
    if (destroyed || state === next) return;
    if (next === 'connected') everConnected = true;
    state = next;
    if (statesSeen[statesSeen.length - 1] !== next) statesSeen.push(next);
    onState(next);
  };

  const stopConfirmation = (): void => {
    if (confirmation === null) return;
    clearTimeout(confirmation);
    confirmation = null;
  };

  /**
   * A connection that has already worked once has to hold for `confirmationMs` before
   * it is believed: a socket that comes up and drops again a moment later should leave
   * the badge on "Reconnecting…", not flash a connection nobody can rely on.
   */
  const confirmInDueCourse = (): void => {
    if (state === 'connected' || confirmation !== null) return;
    if (!everConnected) {
      publish('connected');
      return;
    }
    confirmation = setTimeout(() => {
      confirmation = null;
      publish('connected');
    }, confirmationMs);
  };

  const onProviderStatus = (status: ProviderStatus): void => {
    if (status === 'connected') {
      confirmInDueCourse();
      return;
    }
    stopConfirmation();
    // Losing the socket after it once worked is "Reconnecting…"; before it ever worked
    // the badge keeps saying what it has been saying since the page opened.
    publish(everConnected ? 'reconnecting' : 'connecting');
  };

  const onProviderSync = (isSynced: boolean): void => {
    synced = isSynced;
    if (isSynced) {
      confirmInDueCourse();
      return;
    }
    stopConfirmation();
    if (everConnected) publish('reconnecting');
  };

  provider.onStatus(onProviderStatus);
  provider.onSync(onProviderSync);

  // Two ways a connection can be stuck without ever saying so, and neither is reported by an
  // event: an attempt that hangs (no `connected`, no `disconnected`, nothing) and a line that
  // stops answering. Both would sit there indefinitely, because the provider's retries are
  // scheduled by closes and its own keepalive is three times as patient as we need it to be.
  // So somebody has to keep asking whether the line is actually going anywhere.
  const lineWatchdog = setInterval(() => {
    if (destroyed) return;
    provider.abandonStalledDial?.(dialTimeoutMs);
    provider.abandonSilentLine?.(silenceMs);
  }, Math.max(250, Math.min(1000, Math.floor(Math.min(dialTimeoutMs, silenceMs) / 4))));


  // Who we are, published once. The name and colour come from the local identity and
  // never change during a session; cursor position is story 6 and goes here too.
  provider.awareness?.setLocalStateField('user', { name: identity.name, color: identity.color });

  publish('connecting');

  return {
    get state() {
      return state;
    },
    get synced() {
      return synced;
    },
    statesSeen: () => statesSeen.slice(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(lineWatchdog);
      stopConfirmation();
      provider.offStatus(onProviderStatus);
      provider.offSync(onProviderSync);
      provider.destroy();
    },
  };
}

/** The badge text for a status, and the class that colours it. */
export function connectionLabel(status: BoardStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'invalid-board':
      return 'Not a valid board link';
    case 'connected':
      return 'Connected';
  }
}

/** Whether the badge should be on screen at all. */
export function connectionIsVisible(status: BoardStatus): boolean {
  return status !== 'connected';
}

