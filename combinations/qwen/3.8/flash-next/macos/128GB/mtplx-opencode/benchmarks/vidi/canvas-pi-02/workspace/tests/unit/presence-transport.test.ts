import { describe, expect, test } from 'vitest';

import { CURSOR_BROADCAST_INTERVAL_MS, PRESENCE_RECONNECT_RECONCILE_MS } from '../../src/shared/config';
import {
  createPresenceChannel,
  type PresenceProvider,
  type PresenceState,
} from '../../src/client/presence/transport';

/**
 * Story 6, task 12: publishing and people derivation.
 *
 * The channel is the only place in the client that touches the wire, and the
 * three rules it owns — one announcement per window, one person per person,
 * and "gone means gone straight away" — are all things a browser test can only
 * observe by accident. So they are pinned here, against a twenty-line fake
 * provider and a clock that goes where the test tells it.
 */

/** A stand-in for `Awareness`: a map, a setter that remembers, and an event. */
class FakeAwareness {
  readonly states = new Map<number, Record<string, unknown>>();
  readonly writes: { field: string; value: PresenceState | null }[] = [];
  private readonly listeners: ((update: unknown, origin: unknown) => void)[] = [];

  constructor(
    readonly clientID: number,
    initial: readonly [number, Record<string, unknown>?][] = [],
  ) {
    for (const [id, state] of initial) {
      if (state !== undefined && state !== null) this.states.set(id, { ...state });
    }
  }

  setLocalStateField(field: string, value: unknown): void {
    this.writes.push({ field, value: value as PresenceState | null });
    const mine = this.states.get(this.clientID) ?? {};
    mine[field] = value;
    this.states.set(this.clientID, mine);
    for (const listener of this.listeners) listener(null, 'local');
  }

  on(_event: string, handler: (update: unknown, origin: unknown) => void): void {
    this.listeners.push(handler);
  }

  off(_event: string, handler: (update: unknown, origin: unknown) => void): void {
    const index = this.listeners.indexOf(handler);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  /**
   * Play an update the way the wire would, with whatever origin the real thing
   * would have given it. `setLocalStateField` is a local edit; a link dropping
   * is a different kind of local edit, and the channel treats them differently.
   */
  emitUpdate(origin: unknown): void {
    for (const listener of [...this.listeners]) listener(null, origin);
  }
}

function providerOf(
  awareness: FakeAwareness | null,
  socket: { readyState: number; sent: Uint8Array[] } | null = null,
): { provider: PresenceProvider; sent: Uint8Array[] } {
  const sent = socket?.sent ?? [];
  return {
    provider: {
      awareness,
      ws: socket === null ? null : { readyState: socket.readyState, send: (data) => sent.push(data) },
      OPEN: 1,
    },
    sent,
  };
}

const ME = { id: 'g_me', name: 'Curious Otter', color: '#E53935' };

/** Whose state, at what position, with what in hand. */
function state(
  name: string,
  options: {
    color?: string;
    id?: string;
    t?: number;
    x?: number | null;
    y?: number | null;
    sel?: readonly string[];
  } = {},
): Record<string, unknown> {
  return {
    presence: {
      name,
      color: options.color ?? '#1E88E5',
      id: options.id ?? `p_${name}`,
      t: options.t ?? 0,
      x: options.x ?? 5,
      y: options.y ?? 5,
      sel: options.sel ?? [],
    },
  };
}

function channelOf(
  awareness: FakeAwareness | null,
  socket: { readyState: number; sent: Uint8Array[] } | null = null,
  clock = { now: 1_000 },
  timers: { queue: { at: number; run: () => void }[]; now: number } = { queue: [], now: 1_000 },
) {
  const { provider, sent } = providerOf(awareness, socket);
  const channel = createPresenceChannel({
    identity: () => ME,
    provider,
    now: () => clock.now,
    setTimeoutFn: (callback, ms) => {
      const at = timers.now + ms;
      const timer = { at, run: () => callback() };
      timers.queue.push(timer);
      return timer;
    },
    clearTimeoutFn: (handle) => {
      const index = timers.queue.indexOf(handle as { at: number; run: () => void });
      if (index >= 0) timers.queue.splice(index, 1);
    },
  });
  return { channel, sent, timers, clock };
}

/** Run everything scheduled up to and including `at`, in time order. */
function advanceTo(timers: { queue: { at: number; run: () => void }[]; now: number }, at: number) {
  timers.now = at;
  const due = timers.queue.filter((timer) => timer.at <= at).sort((a, b) => a.at - b.at);
  timers.queue = timers.queue.filter((timer) => timer.at > at);
  for (const timer of due) timer.run();
}

describe('who the board is drawn from', () => {
  test('my own pointer is not a person I have to draw', () => {
    const awareness = new FakeAwareness(7, [[7, state('Curious Otter', { id: 'g_me' })]]);
    const { channel } = channelOf(awareness);
    // The board already has a pointer on this screen: a second arrow for it is a
    // bug people notice the moment they move the mouse.
    expect(channel.people()).toEqual([]);
  });

  test('my other tab is the same person, so it is not drawn either', () => {
    const awareness = new FakeAwareness(7, [
      [9, state('Curious Otter', { id: 'g_me', x: 40, y: 40 })],
    ]);
    const { channel } = channelOf(awareness);
    expect(channel.people()).toEqual([]);
  });

  test('one person with two windows is one person, and the newer window wins', () => {
    const awareness = new FakeAwareness(7, [
      [11, state('Brave Heron', { id: 'g_heron', t: 100, x: 10, y: 10 })],
      [12, state('Brave Heron', { id: 'g_heron', t: 400, x: 70, y: 80 })],
      [13, state('Quiet Falcon', { id: 'g_falcon', t: 200 })],
    ]);
    const { channel } = channelOf(awareness);
    const people = channel.people();
    expect(people.map((person) => person.clientId)).toEqual([12, 13]);
    expect(people[0]).toMatchObject({ name: 'Brave Heron', x: 70, y: 80 });
  });

  test('a person we cannot identify is not quietly merged with a neighbour', () => {
    // Both say `Brave Heron` and neither says who they are: the only honest
    // answer is two people, because two browsers that refuse to say are two
    // browsers, and this is also how an older client keeps working.
    const awareness = new FakeAwareness(7, [
      [11, { presence: { name: 'Brave Heron', color: '#1E88E5', x: 10, y: 10 } }],
      [12, { presence: { name: 'Brave Heron', color: '#1E88E5', x: 20, y: 20 } }],
    ]);
    const { channel } = channelOf(awareness);
    expect(channel.people().map((person) => person.clientId)).toEqual([11, 12]);
  });

  test('a state that names nobody is skipped rather than drawn', () => {
    const awareness = new FakeAwareness(7, [
      [11, { }],
      [12, { presence: { x: 1, y: 1 } }],
      [13, { presence: 'not even an object' }],
      [14, state('Quiet Falcon')],
    ]);
    const { channel } = channelOf(awareness);
    const people = channel.people();
    // Somebody who cannot be named cannot be drawn, and must not take the place
    // of somebody who can: a board missing a person is wrong, a board inventing
    // one is worse.
    expect(people.map((person) => person.clientId)).toEqual([14]);
  });

  test('a position that is not a number is no position', () => {
    const awareness = new FakeAwareness(7, [
      [11, { presence: { name: 'Brave Heron', color: '#1E88E5', id: 'p_a', x: '12', y: null } }],
      [12, { presence: { name: 'Quiet Falcon', color: '#43A047', id: 'p_b', x: Number.NaN, y: 3 } }],
      [13, { presence: { name: 'Clever Octopus', color: '#FB8C00', id: 'p_c', x: Number.POSITIVE_INFINITY, y: 3 } }],
    ]);
    const { channel } = channelOf(awareness);
    for (const person of channel.people()) {
      // `NaN` would place an arrow at NaN, which draws nothing anywhere and keeps
      // being recomputed forever; a hand-written `x` is not a place either.
      expect(Number.isFinite(person.x ?? 0)).toBe(true);
      expect(person.x).toBeNull();
    }
  });

  test('what a person has in hand comes with them', () => {
    const awareness = new FakeAwareness(7, [[11, state('Brave Heron', { sel: ['n1'] })]]);
    const { channel } = channelOf(awareness);
    expect(channel.people()[0]?.selection).toEqual(['n1']);
  });

  test('a selection that is not a list of ids draws nothing', () => {
    const awareness = new FakeAwareness(7, [
      [11, { presence: { name: 'Brave Heron', color: '#1E88E5', id: 'p_a', sel: 'n1' } }],
      [12, { presence: { name: 'Quiet Falcon', color: '#43A047', id: 'p_b', sel: [3, 'n2', null] } }],
    ]);
    const { channel } = channelOf(awareness);
    expect(channel.people()[0]?.selection).toEqual([]);
    // The one real id survives the junk next to it: a stranger's typo is not a
    // reason to lose a person's whole selection.
    expect(channel.people()[1]?.selection).toEqual(['n2']);
  });

  test('a board I am not connected to knows nobody and says nothing', () => {
    const { channel } = channelOf(null);
    expect(channel.people()).toEqual([]);
    // A local board has no channel to shout into; the call still has to be safe.
    expect(() => channel.publish(1, 2)).not.toThrow();
    expect(() => channel.publishSelection(['n1'])).not.toThrow();
    expect(() => channel.hide()).not.toThrow();
    expect(() => channel.query()).not.toThrow();
  });
});

describe('how often my own pointer goes out', () => {
  test('TC-17 twenty moves inside one window are one send, plus the last position', () => {
    const awareness = new FakeAwareness(7);
    const { channel, timers } = channelOf(awareness);
    const writes = awareness.writes;

    channel.publish(1, 1);
    for (let move = 2; move <= 20; move += 1) {
      // Same instant: the throttle is a rate, not a queue.
      channel.publish(move, move);
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]?.value).toMatchObject({ x: 1, y: 1 });

    advanceTo(timers, 1_000 + CURSOR_BROADCAST_INTERVAL_MS);
    // The trailing send carries where the pointer *stopped*, not where it
    // started: a flick that ends in the corner has to be reported in the corner.
    expect(writes).toHaveLength(2);
    expect(writes[1]?.value).toMatchObject({ x: 20, y: 20 });
  });

  test('a move after the window closes goes straight out', () => {
    const awareness = new FakeAwareness(7);
    const { channel, clock } = channelOf(awareness);
    channel.publish(1, 1);
    clock.now += CURSOR_BROADCAST_INTERVAL_MS + 1;
    channel.publish(9, 9);
    expect(awareness.writes).toHaveLength(2);
    expect(awareness.writes[1]?.value).toMatchObject({ x: 9, y: 9 });
  });

  test('TC-18 leaving the board cancels the pending position and says so now', () => {
    const awareness = new FakeAwareness(7);
    const { channel, timers } = channelOf(awareness);
    channel.publish(1, 1);
    channel.publish(5, 5);
    const before = awareness.writes.length;

    channel.hide();
    // Straight away, not at the end of the window: an arrow left hanging where I
    // was is a wrong answer about where I am.
    expect(awareness.writes).toHaveLength(before + 1);
    expect(awareness.writes.at(-1)?.value).toMatchObject({ x: null, y: null });

    // And the trailing send is gone, not merely late: otherwise the arrow comes
    // back on its own a moment after I said it was gone.
    const writesAfterHide = awareness.writes.length;
    advanceTo(timers, 1_000 + CURSOR_BROADCAST_INTERVAL_MS * 3);
    expect(awareness.writes).toHaveLength(writesAfterHide);

    // Coming back needs no warm-up.
    channel.publish(3, 4);
    expect(awareness.writes.at(-1)?.value).toMatchObject({ x: 3, y: 4 });
  });

  test('a tab I cannot see publishes nothing on its own', () => {
    const awareness = new FakeAwareness(7);
    const { channel, timers } = channelOf(awareness);
    channel.publish(2, 2);
    // Hidden while a position is waiting: the pending one must not go out behind
    // my back, which is what a background tab full of stale arrows would be.
    channel.hide();
    const count = awareness.writes.length;
    advanceTo(timers, 1_000 + CURSOR_BROADCAST_INTERVAL_MS * 2);
    expect(awareness.writes).toHaveLength(count);
  });

  test('who I am is said again when I say so, and not by itself', () => {
    const awareness = new FakeAwareness(7);
    const { channel } = channelOf(awareness);
    channel.announce();
    expect(awareness.writes.at(-1)?.value).toMatchObject({
      name: 'Curious Otter',
      color: '#E53935',
      id: 'g_me',
      x: null,
      y: null,
    });
    // A person sitting still is still a person: they belong in the stack whether
    // or not they are pointing at anything.
    expect(awareness.writes).toHaveLength(1);
  });
});

describe('asking who is here', () => {
  test('the question is asked once the link is up, and not before', () => {
    // A socket that is still connecting cannot carry the question, and a query
    // that goes nowhere means a newcomer who waits for somebody to move a mouse.
    const dialling = channelOf(new FakeAwareness(7), { readyState: 0, sent: [] });
    dialling.channel.query();
    expect(dialling.sent).toEqual([]);

    const open = channelOf(new FakeAwareness(7), { readyState: 1, sent: [] });
    open.channel.query();
    expect(open.sent).toHaveLength(1);
    expect(Array.from(open.sent[0] ?? [])).toEqual([3]);
  });

  test('a link that comes up later is asked then, not missed', () => {
    const awareness = new FakeAwareness(7, [[11, state('Brave Heron')]]);
    const socket: { readyState: number; sent: Uint8Array[]; send?(data: Uint8Array): void } = {
      readyState: 0,
      sent: [],
      send: (data) => socket.sent.push(data),
    };
    const provider = providerOf(awareness, socket).provider;
    const statusListeners: ((event: { status: string }) => void)[] = [];
    const channel = createPresenceChannel({
      identity: () => ME,
      provider: {
        ...provider,
        // The socket opens *after* the channel is built, which is the normal
        // order of things: a mount happens while the link is still dialling.
        ws: socket,
        on: (_event, handler) => {
          statusListeners.push(handler);
        },
      },
      now: () => 1_000,
    });
    // A board that is already occupied shows the people on it straight away: the
    // provider filled its awareness before we ever looked.
    expect(channel.people().map((person) => person.clientId)).toEqual([11]);

    // Nothing goes out while the link is down, and everything goes out the moment
    // it is up: a query that goes nowhere means an empty board for the whole visit.
    channel.query();
    expect(socket.sent).toEqual([]);
    socket.readyState = 1;
    for (const listener of statusListeners) listener({ status: 'connected' });
    expect(socket.sent).toHaveLength(1);
    channel.destroy();
  });

  test('a board with no socket asks nothing and sends nothing', () => {
    const { channel, sent } = channelOf(new FakeAwareness(7));
    channel.query();
    expect(sent).toEqual([]);
  });
});

describe('what I have picked up', () => {
  test('a selection is published once, and dropping it is published too', () => {
    const awareness = new FakeAwareness(7);
    const { channel } = channelOf(awareness);
    channel.publishSelection(['n1']);
    channel.publishSelection(['n1']);
    expect(awareness.writes).toHaveLength(1);
    expect(awareness.writes[0]?.value).toMatchObject({ sel: ['n1'] });

    channel.publishSelection([]);
    expect(awareness.writes.at(-1)?.value).toMatchObject({ sel: [] });
  });

  test('the second pick replaces the first, because there is only ever one', () => {
    const awareness = new FakeAwareness(7);
    const { channel } = channelOf(awareness);
    channel.publishSelection(['n1']);
    channel.publishSelection(['n2', 'n3']);
    expect(awareness.writes.at(-1)?.value).toMatchObject({ sel: ['n2'] });
  });
});

describe('a link that wobbles is not a room emptying', () => {
  /**
   * `y-websocket` deletes every remote presence state the moment its socket
   * closes, and that is the one event the overlay cannot tell apart from everybody
   * leaving — so the two directions of the lie are both pinned here: a wobble must
   * not empty the board, and a board that really did empty must not stay drawn.
   */
  function linkWithTwoPeople() {
    const awareness = new FakeAwareness(7, [
      [9, state('Brave Heron', { t: 100, x: 10, y: 10 })],
      [10, state('Quiet Falcon', { t: 200, x: 40, y: 40 })],
    ]);
    const socket = { readyState: 1, sent: [] as Uint8Array[] };
    const provider: PresenceProvider = {
      awareness,
      ws: { readyState: socket.readyState, send: (data) => socket.sent.push(data) },
      OPEN: 1,
    };
    const timers = { queue: [] as { at: number; run: () => void }[], now: 1_000 };
    const statusListeners: ((event: { status: string }) => void)[] = [];
    const channel = createPresenceChannel({
      identity: () => ME,
      provider: {
        ...provider,
        on: (_event, handler) => {
          statusListeners.push(handler as (event: { status: string }) => void);
        },
      },
      now: () => timers.now,
      setTimeoutFn: (callback, ms) => {
        const timer = { at: timers.now + ms, run: () => callback() };
        timers.queue.push(timer);
        return timer;
      },
      clearTimeoutFn: (handle) => {
        const index = timers.queue.indexOf(handle as { at: number; run: () => void });
        if (index >= 0) timers.queue.splice(index, 1);
      },
    });
    return { awareness, channel, provider, socket, statusListeners, timers };
  }

  test('the people held through a drop are kept, and the room is re-asked', () => {
    const board = linkWithTwoPeople();
    expect(board.channel.people()).toHaveLength(2);

    // The link drops, and with it the two states this browser was holding. This
    // is the moment a naive reader empties the board.
    for (const listener of board.statusListeners) listener({ status: 'disconnected' });
    board.awareness.states.delete(9);
    board.awareness.states.delete(10);
    board.awareness.emitUpdate(board.provider);
    expect(board.channel.people()).toHaveLength(2);

    // Back up: the room is asked who is here, and the answer gets a window to
    // arrive in. Nobody answered, so the two are finally taken out of the draw.
    for (const listener of board.statusListeners) listener({ status: 'connected' });
    expect(board.socket.sent).toHaveLength(1);
    board.timers.now = 1_000 + PRESENCE_RECONNECT_RECONCILE_MS + 1;
    for (const timer of [...board.timers.queue]) {
      if (timer.at <= board.timers.now) timer.run();
    }
    expect(board.channel.people()).toHaveLength(0);
    board.channel.destroy();
  });

  test('an update that arrives over a live link is drawn, which is the whole point', () => {
    // The other half of the rule, and the one worth pinning: a shortcut that
    // "holds" presence on the way out still has to keep drawing it the rest of
    // the time. Here nothing ever drops, two people are announced and a third
    // arrives, and all three are drawn.
    const board = linkWithTwoPeople();
    expect(board.channel.people()).toHaveLength(2);
    board.awareness.states.set(11, state('Loud Kestrel', { t: 300, x: 5, y: 5 }));
    board.awareness.emitUpdate(new Uint8Array([1]));
    expect(board.channel.people().map((person) => person.clientId)).toEqual([9, 10, 11]);
    board.channel.destroy();
  });

  test('someone who is still there is never taken out of the draw', () => {
    const board = linkWithTwoPeople();
    for (const listener of board.statusListeners) listener({ status: 'disconnected' });
    board.awareness.states.delete(9);
    board.awareness.states.delete(10);
    board.awareness.emitUpdate(board.provider);
    // Held, not forgotten: for the length of a wobble nobody has left.
    expect(board.channel.people()).toHaveLength(2);

    // Reconnected, and the first answer arrives from the network while the hold
    // is still open: a person who never left must not be made to leave and come
    // back, which is what an outline doing a victory lap is.
    // is still open: a person who never left must not be made to leave and come
    // back, which is what an outline doing a victory lap is.
    for (const listener of board.statusListeners) listener({ status: 'connected' });
    board.awareness.states.set(9, state('Brave Heron', { t: 900, x: 10, y: 10 }));
    board.awareness.emitUpdate(new Uint8Array([1]));
    expect(board.channel.people().map((person) => person.clientId)).toEqual([9]);

    // And after the window, with nobody else answering, only the one who came
    // back is drawn: the hold is a pause, not a grudge.
    board.timers.now = 1_000 + PRESENCE_RECONNECT_RECONCILE_MS + 1;
    for (const timer of [...board.timers.queue]) {
      if (timer.at <= board.timers.now) timer.run();
    }
    expect(board.channel.people().map((person) => person.clientId)).toEqual([9]);
    board.channel.destroy();
  });
});
