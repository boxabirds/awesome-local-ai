import { CURSOR_BROADCAST_INTERVAL_MS, PRESENCE_RECONNECT_RECONCILE_MS } from '../../shared/config';
import { queryAwarenessMessage } from '../../shared/protocol';
import { type Person, dedupePeople, nameLabel } from './people';
import type { Identity } from './identity';

/**
 * Carrying presence over the board's own connection (story 6, task 3).
 *
 * Three jobs, all of them about *carrying* rather than deciding:
 *
 *  1. ask the room "who is here?" when the link comes up, because a newcomer
 *     otherwise sees nobody until somebody happens to move a mouse;
 *  2. publish this pointer, at most every `CURSOR_BROADCAST_INTERVAL_MS`, with
 *     a trailing send so a pointer that stops mid-swipe is still reported
 *     where it stopped;
 *  3. read the other people back out and hand the overlay a snapshot.
 *
 * ## Why it reads the provider's awareness rather than the frames
 *
 * `y-websocket` decodes incoming presence into per-client states and keeps
 * them in an `Awareness`. Those states are what the receiver draws, and they
 * are the thing that already knows about a removal that arrived while the tab
 * was in the background. Re-decoding the bytes here would be a second opinion
 * about who is in the room, and the two would disagree at exactly the moment
 * that matters.
 *
 * ## Why the query goes out over the socket, not the provider
 *
 * `y-websocket` 2.x has no public "send this frame" method, and it has no
 * handler for the room's own "who is here?" message, so a client that waits to
 * be told never learns anything. The provider does keep the raw `WebSocket` in
 * `provider.ws`, and a frame on that socket is `[type, …]` with no outer
 * length — the same shape the room's relay sends back. Writing one byte
 * through it is the smallest door that exists, and it is written *when the
 * link comes up* rather than once at mount, because at mount the socket is
 * usually not open yet and a dropped query means an empty board for the whole
 * visit.
 *
 * ## Why everything is injected
 *
 * Provider, clock and timers come in as arguments, so the throttle and the
 * staleness rules are testable with fake timers and a twenty-line fake
 * provider, and so a board with no connection — a local board, or a component
 * test — gets a channel that knows nobody instead of a crash.
 */

/** The presence state one person publishes, as it arrives on the wire. */
export interface PresenceState {
  name?: unknown;
  color?: unknown;
  /** Whose browser this is, so two tabs of one person are not two people. */
  id?: unknown;
  /** When the sender wrote it, to pick the newer of two tabs of one person. */
  t?: unknown;
  x?: unknown;
  y?: unknown;
  /** The note ids this person has picked up. */
  sel?: unknown;
}

/**
 * The slice of `Awareness` this file uses.
 *
 * `on` and `off` are optional because the provider seam in
 * `sync/connectBoard` describes presence structurally, and a fake that only
 * answers `states` is a legitimate one: the channel then reports whoever was
 * there when it was built, which is what a single-render test needs.
 */
export interface AwarenessLike {
  /** The other people's states, keyed by client id. */
  readonly states: Map<number, Record<string, unknown>>;
  setLocalStateField?(field: string, value: unknown): void;
  on?(event: string, handler: (update: unknown, origin: unknown) => void): void;
  off?(event: string, handler: (update: unknown, origin: unknown) => void): void;
  /** Our own client id, so my cursor is not drawn a second time. */
  clientID?: number;
}

/** What a channel needs from the provider. All of it optional. */
export interface PresenceProvider {
  readonly awareness?: AwarenessLike | null;
  /** The raw socket, only used to ask "who is here?". */
  readonly ws?: { readyState: number; send?(data: Uint8Array): void } | null;
  /** `1` is an open WebSocket; declared here so this file needs no DOM lib. */
  readonly OPEN?: number;
  on?(event: string, handler: (event: { status: string }) => void): void;
  off?(event: string, handler: (event: { status: string }) => void): void;
}

export interface PresenceChannel {
  /** The people to draw, this instant. Stable while nothing changes. */
  people(): readonly Person[];
  /** Report this pointer's world position, throttled. */
  publish(x: number, y: number): void;
  /**
   * Say who I am again, at the last known position.
   *
   * This is how the no-duplicate rule is kept: a second tab that finds its
   * chosen name already taken has to be able to change it *after* the first
   * announcement went out, or every board would be full of Rivers.
   */
  announce(): void;
  /** Ask the room who is here. Called on mount and on every reconnect. */
  query(): void;
  /**
   * Stop pointing, right now.
   *
   * The throttle exists to stop a swipe costing bandwidth; a pointer that has
   * *left* the board is not a swipe, and an arrow that hangs in the middle of
   * somebody's screen for two seconds after you went to make a coffee is a lie
   * about where you are looking. So this jumps the queue, and cancels the
   * trailing send that would otherwise put the arrow back.
   */
  hide(): void;
  /** What this screen has picked up, so the other four can draw an outline. */
  publishSelection(ids: readonly string[]): void;
  /** Rebuild the snapshot from the provider's current states. */
  refresh(): void;
  /** Stop listening. */
  destroy(): void;
}

export interface PresenceChannelOptions {
  /**
   * Who we are, read when it is needed rather than captured at construction.
   *
   * A name chosen before the first presence arrives is a guess, and a guess
   * that cannot be corrected is how two people end up labelled the same.
   */
  identity: () => Identity;
  /** Where the connection is. `null` is a local board with nobody on it. */
  provider: PresenceProvider | null;
  /** The clock, injected so the staleness rules are testable. */
  now: () => number;
  /** How to schedule the trailing cursor send. */
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Notified whenever the people snapshot actually changes. */
  onChange?: () => void;
}

/** The one field this client writes into its own awareness state. */
const FIELD = 'presence';

/** `WebSocket.OPEN`. */
const SOCKET_OPEN = 1;

/** Is this state something we can draw? Anything else is not a person. */
function personFrom(
  clientId: number,
  state: Record<string, unknown>,
  now: number,
): Person | null {
  const presence = state[FIELD] as PresenceState | undefined;
  if (presence === undefined || presence === null || typeof presence !== 'object') return null;
  if (typeof presence.name !== 'string' || typeof presence.color !== 'string') return null;
  const x = typeof presence.x === 'number' && Number.isFinite(presence.x) ? presence.x : null;
  const y = typeof presence.y === 'number' && Number.isFinite(presence.y) ? presence.y : null;
  // Only real ids count: a state that names nothing, or names a number, is a
  // person who is not selecting anything rather than a crash waiting to happen.
  const selection = Array.isArray(presence.sel)
    ? (presence.sel as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  return {
    clientId,
    name: nameLabel(presence.name),
    color: presence.color,
    id: typeof presence.id === 'string' ? presence.id : '',
    x,
    y,
    selection,
    lastActive: now,
    // A sender that says nothing about when it wrote this is treated as oldest,
    // so a state that *does* carry a time wins a merge rather than losing to a
    // default of zero.
    sentAt: typeof presence.t === 'number' && Number.isFinite(presence.t) ? presence.t : 0,
  };
}

/**
 * Do two snapshots say the same thing?
 *
 * Comparison, not notification-per-event, is what keeps the board renderable:
 * a pointer move every fifty milliseconds would otherwise re-render five
 * hundred notes twenty times a second, and my *own* cursor has never once
 * needed the board to redraw itself.
 */
function samePeople(a: readonly Person[], b: readonly Person[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (person, index) =>
      b[index] !== undefined &&
      b[index]!.clientId === person.clientId &&
      b[index]!.x === person.x &&
      b[index]!.y === person.y &&
      b[index]!.name === person.name &&
      sameSelection(b[index]!.selection, person.selection),
  );
}

/** Do two people have the same notes picked up? */
function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

/**
 * Build the presence channel for one connection.
 *
 * A channel with no awareness is a channel that knows nobody and publishes
 * nothing, which is the right answer for a local board and for the fake
 * providers the connection tests hand in.
 */
export function createPresenceChannel(options: PresenceChannelOptions): PresenceChannel {
  const provider = options.provider;
  const awareness = provider?.awareness ?? null;
  const setTimer =
    options.setTimeoutFn ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimeoutFn ?? ((handle: unknown) => clearTimeout(handle as never));
  const me = awareness?.clientID ?? null;
  const myId = options.identity().id;

  let snapshot: readonly Person[] = [];

  let last: { x: number; y: number } | null = null;
  let selection: readonly string[] = [];
  let pending: { x: number; y: number } | null = null;
  let timer: unknown = null;
  let lastPublished = Number.NEGATIVE_INFINITY;

  const rebuild = (): void => {
    const next: Person[] = [];
    if (awareness !== null) {
      const now = options.now();
      for (const [clientId, state] of awareness.states) {
        // My own state is never drawn: this screen already has a pointer, and a
        // board that shows two arrows for one person is a bug people notice at
        // once. The same goes for my *other* tab, which shares this browser's
        // identity — that is one person with two windows, not two people.
        if (clientId === me) continue;
        const person = personFrom(clientId, state, now);
        if (person === null) continue;
        if (myId !== '' && person.id === myId) continue;
        next.push(person);
      }
      // And if a person's identity arrives by two routes at once (a second tab
      // that this client id does not know is the same person), one dot.
      const merged = dedupePeople(next);
      if (samePeople(snapshot, merged)) return;
      snapshot = merged;
      options.onChange?.();
    }
  };

  /**
   * Whether the link to the room is currently down.
   *
     * A link dropping makes `y-websocket` delete every remote presence state it
   * holds, all at once, on the way out — it is bookkeeping, not news. Drawing
   * that would empty the stack and the cursors for the length of a wobble and
   * then refill them, which reads as everybody leaving and coming back.
   *
   * The provider already knows the difference, and this asks it rather than
   * trusting a flag of its own: `wsconnected` is switched off *before* those
   * states are removed, and back on before anything from the room is applied to
   * them again. So an update that arrives on a dead link is held, and one that
   * arrives on a live link is always drawn — that second half matters more than
   * the first. Providers that do not expose the flag (the fakes in the tests, and
   * a board opened with no connection at all) fall back to the status events.
   *
   * Holding is not pretending. When the link comes back the channel asks the room
   * who is here and, once the answer has had `PRESENCE_RECONNECT_RECONCILE_MS`
   * to arrive, rebuilds from it, so a person who really did go stops being drawn.
   */
  let linkDown = false;
  /** Open for a moment after a reconnect: the room has been asked, not answered. */
  let reconcile: unknown = null;

  const linkAlive = (): boolean => {
    const connected = (provider as { wsconnected?: boolean } | null | undefined)?.wsconnected;
    return typeof connected === 'boolean' ? connected : !linkDown;
  };

  const handleAwareness = (): void => {
    if (!linkAlive()) return;
    rebuild();
  };

  const handleStatus = (event: { status: string }): void => {
    if (event.status !== 'connected') {
      linkDown = true;
      if (reconcile !== null) {
        clearTimer(reconcile);
        reconcile = null;
      }
      return;
    }
    // Back up. Ask who is here, and give the answer a window to arrive in before
    // the board is rebuilt from it. The query belongs to a *live* link: asked
    // while the socket is still dialling it goes nowhere, and the newcomer waits
    // for a mouse move instead.
    linkDown = false;
    reconcile = setTimer(() => {
      reconcile = null;
      rebuild();
    }, PRESENCE_RECONNECT_RECONCILE_MS);
    channel.query();
  };

  const write = (at: { x: number; y: number } | null): void => {
    const identity = options.identity();
    if (at !== null) last = at;
    awareness?.setLocalStateField?.(FIELD, {
      name: identity.name,
      color: identity.color,
      id: identity.id,
      t: options.now(),
      x: at?.x ?? null,
      y: at?.y ?? null,
      // Only ever one or none, which is all a board without multi-select has.
      sel: selection,
    });
  };

  awareness?.on?.('update', handleAwareness);
  provider?.on?.('status', handleStatus);
  // Built once here rather than only on the first event: `people()` promises the
  // people to draw *this instant*, and a channel that starts out empty draws an
  // empty stack until somebody happens to move a mouse.
  rebuild();


  const channel: PresenceChannel = {
    people: () => snapshot,
    announce() {
      // The same bytes again with a different name is not a duplicate: the
      // receiver keys presence by client id and clock, and this bumps the
      // clock. Without it a renamed tab is drawn under the name it had when it
      // arrived. A person who has not moved yet is announced with no position:
      // they belong in the stack whether or not they are pointing at anything.
      if (last !== null) write({ ...last });
      else write(null);
    },
    publish(x, y) {
      if (awareness === null) return;
      const now = options.now();
      if (now - lastPublished >= CURSOR_BROADCAST_INTERVAL_MS) {
        lastPublished = now;
        pending = null;
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
        write({ x, y });
        return;
      }
      // Inside the window: remember where it ended and send that when the
      // window closes, so a flick that ends still reports its last position.
      pending = { x, y };
      if (timer !== null) return;
      timer = setTimer(() => {
        timer = null;
        const spot = pending;
        pending = null;
        if (spot === null) return;
        lastPublished = options.now();
        write({ ...spot });
      }, CURSOR_BROADCAST_INTERVAL_MS - (now - lastPublished));
    },
    hide() {
      // Whatever was waiting to go out dies here: a trailing position sent
      // after a leave is the arrow reappearing on its own.
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      pending = null;
      if (last === null) return;
      last = null;
      // Back to "never published", so the next move is reported immediately
      // rather than waiting out a window that ran out while nobody was looking.
      lastPublished = Number.NEGATIVE_INFINITY;
      write(null);
    },
    publishSelection(ids) {
      const next = ids.length === 0 ? [] : [(ids[0] as string) ?? ''];
      if (sameSelection(selection, next)) return;
      selection = next;
      // Straight out, no throttle: a selection is one click, not a swipe, and a
      // delay here is an outline that arrives after the person has moved on. The
      // pointer goes with it, because where I last pointed is where I still am.
      write(last === null ? null : { ...last });
    },
    query() {
      const socket = provider?.ws;
      if (socket === null || socket === undefined) return;
      if (socket.readyState !== (provider?.OPEN ?? SOCKET_OPEN)) return;
      if (typeof socket.send !== 'function') return;
      // The one-byte "who is here?" frame, answered by the room from what it
      // already knows about the people already here.
      socket.send(queryAwarenessMessage());
      // Whatever the room answers arrives as a message, and the states land in
      // the awareness; refresh once so a reply that was already there (a fake,
      // or a re-query after a reconnect) is not missed. Skipped while the
      // outage hold is open, where the whole point is *not* to read an empty
      // awareness as an empty room.
      if (reconcile === null) rebuild();
    },
    refresh: rebuild,
    destroy() {
      awareness?.off?.('update', handleAwareness);
      provider?.off?.('status', handleStatus);
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (reconcile !== null) clearTimer(reconcile);
      reconcile = null;
      pending = null;
      snapshot = [];
    },
  };

  return channel;
}
