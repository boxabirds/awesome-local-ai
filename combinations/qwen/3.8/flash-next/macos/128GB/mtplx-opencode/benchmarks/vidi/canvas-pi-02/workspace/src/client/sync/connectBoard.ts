/**
 * The client side of live collaboration (story 3).
 *
 * `createConnection` wires a `Y.Doc` to one board's room and turns the noisy
 * events of a WebSocket provider into the four states the interface needs:
 *
 * ```text
 * connecting ──► connected (hidden)
 *      ▲               │
 *      └── reconnecting┴── confirming ("Connected", 2 s) ──► hidden
 * ```
 *
 * Two decisions worth stating, because both were argued about:
 *
 * 1. **"Connected" is earned, not assumed.** An open socket is not enough: the
 *    board is only *connected* once the document has been exchanged. A board
 *    whose link is open but which has not caught up yet is a board with other
 *    people's edits missing, and that is exactly the state the badge must not
 *    hide. This is also why a reconnect reads "Reconnecting…" until the
 *    provider reports it is synced, not until the socket says "open".
 * 2. **A drop is never a lockout.** Every state keeps the board editable; the
 *    badge reports, it does not gate (PRD: `live.forgiving`). The keyboard
 *    ownership from story 2 and the undo behaviour from story 22 are unchanged
 *    by anything in this file.
 *
 * The provider is created through a factory so the state machine can be tested
 * with a fake emitter and fake timers - the design's "component tests use a
 * fake provider plus fake timers" line - and so nothing here needs a network.
 */
import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/** What the badge can show. `connected` renders nothing at all. */
export type ConnectionState = 'connecting' | 'reconnecting' | 'confirming' | 'connected';

/**
 * The part of a provider this module depends on.
 *
 * `WebsocketProvider` is structurally compatible: it emits `status` with
 * `{ status }` and `synced` with a boolean, and it has `synced` /
 * `wsconnected` / `destroy`. Keeping the interface small is what lets the
 * tests hand in a 20-line fake.
 */
export interface ProviderLike {
  on(event: string, handler: (argument: never) => void): void;
  destroy(): void;
  readonly synced: boolean;
  readonly wsconnected: boolean;
}

export interface BoardConnection {
  /** The board room this connection is attached to. */
  readonly room: string;
  /** The current state, for `useSyncExternalStore`. */
  getState(): ConnectionState;
  /** Subscribe to state changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Tear the provider down. Called on unmount and on board change. */
  destroy(): void;
  /** The provider, for the test hooks and for story 6's presence. */
  readonly provider: ProviderLike;
}

export interface ConnectionOptions {
  /** Override how the provider is built. Tests pass a fake. */
  providerFactory?: (url: string, room: string, doc: Y.Doc) => ProviderLike;
  /** Override the confirmation timer. Tests use fake timers. */
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Notified on every state change, including the initial one. */
  onState?: (state: ConnectionState) => void;
}

/**
 * How often a client re-asks the room for anything it is missing.
 *
 * `y-websocket` tears down a connection that has received nothing for 30 s,
 * and on a board nobody is editing, nothing else produces traffic. A periodic
 * SyncStep1 gives the room something to answer with, which is what keeps an
 * idle but healthy connection in `connected` - and it is what closes the gap
 * the PRD's `live.catch_up` check leaves after a 30 s outage.
 */
const KEEPALIVE_INTERVAL_MS = RECONNECT_MAX_BACKOFF_MS;

/** The WebSocket origin for a page origin, or the dev default in Node. */
export function roomUrl(origin: string): string {
  const trimmed = origin.replace(/\/+$/, '');
  // The socket speaks ws/wss; everything else in the app speaks http/https.
  const socket = trimmed.startsWith('https') ? 'wss' : 'ws';
  const host = trimmed.replace(/^https?:\/\//, '');
  return `${socket}://${host}/api/rooms`;
}

/** Where the page is, for building the room URL. */
function pageOrigin(): string {
  if (typeof window === 'undefined' || !window.location) return 'http://localhost:5173';
  return `${window.location.protocol}//${window.location.host}`;
}

/** The URL a client would open for `boardId`. Logged, and asserted in tests. */
export function roomSocketUrl(boardId: string, origin: string = pageOrigin()): string {
  return `${roomUrl(origin)}/${boardId}`;
}

function defaultProviderFactory(
  url: string,
  room: string,
  doc: Y.Doc,
): ProviderLike {
  return new WebsocketProvider(url, room, doc, {
    // No BroadcastChannel: two tabs of the same browser have to go through the
    // room like two real people do, or a broken room would go unnoticed.
    disableBc: true,
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    resyncInterval: KEEPALIVE_INTERVAL_MS,
  }) as unknown as ProviderLike;
}

export interface ConnectionSpec {
  /** The document to share. */
  doc: Y.Doc;
  /** The room to share it in: the board id, never a derived name. */
  room: string;
  /** Full socket URL, including the room path. */
  url?: string;
  options?: ConnectionOptions;
}

/**
 * Attach `spec.doc` to the room named `spec.room`.
 *
 * The connection starts in `connecting` immediately, and a subscriber is
 * notified of that state too: a board that renders before the socket has
 * opened shows "Connecting…" rather than pretending to be fine.
 */
export function createConnection(spec: ConnectionSpec): BoardConnection {
  const options = spec.options ?? {};
  const factory = options.providerFactory ?? defaultProviderFactory;
  const url = spec.url ?? roomUrl(pageOrigin());
  const provider = factory(url, spec.room, spec.doc);
  const setTimer =
    options.setTimeoutFn ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimeoutFn ?? ((handle: unknown) => clearTimeout(handle as never));

  const listeners = new Set<() => void>();
  let state: ConnectionState = 'connecting';
  let confirmation: unknown = null;

  options.onState?.(state);

  const publish = (): void => {
    options.onState?.(state);
    // Copied first: a listener may unsubscribe while we notify.
    for (const listener of [...listeners]) listener();
  };

  const change = (next: ConnectionState): void => {
    if (next === state) return;
    if (confirmation !== null) {
      clearTimer(confirmation);
      confirmation = null;
    }
    state = next;
    publish();
  };

  /**
   * Has the link ever been good? Until it has, there is nothing to reconnect
   * *to*: the first exchange is a board loading, not a board recovering, so it
   * ends in `connected` (nothing shown) rather than in a green badge about a
   * reconnection that never happened.
   */
  let hadGoodLink = false;

  /**
   * A (re)opened and synced link. After the first one this shows the green
   * "Connected" badge for `CONNECTED_CONFIRMATION_MS` - the moment the badge
   * earns its place, because it tells the person the link came back.
   */
  const confirm = (): void => {
    const first = !hadGoodLink;
    hadGoodLink = true;
    if (first) {
      state = 'connected';
      publish();
      return;
    }
    change('confirming');
    confirmation = setTimer(() => {
      confirmation = null;
      // A drop during the confirmation window wins over the timer: the timer
      // only fires while we are still showing the confirmation.
      if (state === 'confirming') {
        state = 'connected';
        publish();
      }
    }, CONNECTED_CONFIRMATION_MS);
  };

  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connected') {
      // Only count it once the document is in sync as well: an open socket to
      // a room we have not caught up with is not yet a working connection.
      // Also skipped when a synced event already got there first - the two
      // events arrive in either order depending on which fires, and a link
      // that is already good must not be announced as a new recovery.
      if (provider.synced && state !== 'connected' && state !== 'confirming') confirm();
      return;
    }
    // 'disconnected', or a fresh 'connecting' after a good link: broken.
    if (hadGoodLink) change('reconnecting');
  });

  provider.on('synced', (synced: boolean) => {
    if (!synced) {
      if (hadGoodLink) change('reconnecting');
      return;
    }
    if (provider.wsconnected && state !== 'connected' && state !== 'confirming') confirm();
  });

  return {
    room: spec.room,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (confirmation !== null) clearTimer(confirmation);
      confirmation = null;
      listeners.clear();
      provider.destroy();
    },
    provider,
  };
}
