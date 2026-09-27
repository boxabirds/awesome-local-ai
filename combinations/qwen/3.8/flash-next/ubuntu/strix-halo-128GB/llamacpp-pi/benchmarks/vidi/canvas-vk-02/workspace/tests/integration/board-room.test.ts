/**
 * tests/integration/board-room.test.ts
 *
 * The room on its own: real documents, real sockets, the real
 * worker -> Durable Object -> worker path. No React, no browser.
 *
 * This is where the requirements a browser test cannot pin down are checked: the
 * CRDT merge cases including the delete that must not come back, the absence of an
 * echo, what presence looks like when it is taken away, and what happens after the
 * object holding the document disappears. Every case is a pair of clients plus the
 * room, and the assertion is always about what the *other* client ends up holding.
 *
 * The clients are `RoomClient`s, not `WebsocketProvider`s — see that helper for
 * why the exact frames matter more here than the convenience.
 */
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  MESSAGE_SYNC,
  awarenessMessage,
  decodeMessage,
  frameMessage,
} from '../../src/shared/protocol';
import {
  awarenessUpdate,
  awarenessUpdateOf,
  boardId,
  connectRoom,
  readAwarenessEntries,
  readAwarenessUpdate,
  RoomClient,
} from './helpers/client';

/** The presence a set of frames announces, by client id, with its clock. */
function presenceWithClocks(frames: readonly Uint8Array[]): Map<number, { clock: number; state: unknown }> {
  const entries = new Map<number, { clock: number; state: unknown }>();
  for (const frame of frames) {
    const update = awarenessUpdateOf(frame);
    if (update === null) continue;
    for (const entry of readAwarenessEntries(update)) {
      entries.set(entry.clientId, { clock: entry.clock, state: entry.state });
    }
  }
  return entries;
}

/** The presence states a set of frames announces, by client id. */
function presenceIn(frames: readonly Uint8Array[]): Map<number, unknown> {
  const states = new Map<number, unknown>();
  for (const frame of frames) {
    const update = awarenessUpdateOf(frame);
    if (update === null) continue;
    for (const [clientId, state] of readAwarenessUpdate(update)) {
      states.set(clientId, state);
    }
  }
  return states;
}

/** How many of these frames carry somebody else's change to the document. */
function updateFrames(frames: Uint8Array[]): number {
  return frames.filter((frame) => {
    const decoded = decodeMessage(frame);
    // Sync kind 2 is Update: "here is what changed".
    return decoded.kind === 'sync' && decoded.payload[0] === 2;
  }).length;
}

/**
 * Let whatever is already in flight land, so that everything a client receives
 * afterwards is about what happens next.
 */
async function settle(...clients: RoomClient[]): Promise<void> {
  for (const client of clients) await client.collect(250);
}

/**
 * Drive two connections until something about the pair of them is true. Neither
 * can wait for the other, so frames are taken from both queues in turn.
 */
async function until(
  a: RoomClient,
  b: RoomClient,
  settled: () => boolean,
  description: string,
): Promise<void> {
  const until = Date.now() + 3_000;
  for (;;) {
    if (settled()) return;
    if (Date.now() > until) throw new Error(`never settled: ${description}`);
    if (!(await a.pump()) && !(await b.pump())) {
      throw new Error(`nothing more is arriving: ${description}`);
    }
  }
}

/**
 * Drive two connections until they hold the same text for one note, and hand that
 * text back. Neither client can wait for the other, so frames are taken from both
 * queues in turn.
 */
async function textConverges(a: RoomClient, b: RoomClient, id: string): Promise<string> {
  const until = Date.now() + 3_000;
  for (;;) {
    const text = a.text(id);
    if (text !== undefined && text === b.text(id)) return text;
    if (Date.now() > until) {
      throw new Error(`text never converged: ${String(a.text(id))} against ${String(b.text(id))}`);
    }
    if (!(await a.pump()) && !(await b.pump())) {
      throw new Error(`nothing more is arriving: ${String(a.text(id))} against ${String(b.text(id))}`);
    }
  }
}

/** Drive two connections until a note's single-value field agrees in both. */
async function fieldConverges(
  a: RoomClient,
  b: RoomClient,
  id: string,
  field: 'color' | 'x' | 'y' | 'z',
): Promise<unknown> {
  const until = Date.now() + 3_000;
  for (;;) {
    const value = a.value(id, field);
    if (value !== undefined && value === b.value(id, field)) return value;
    if (Date.now() > until) throw new Error(`${field} never converged`);
    if (!(await a.pump()) && !(await b.pump())) throw new Error(`nothing more is arriving for ${field}`);
  }
}

/**
 * Forget the board's Durable Object and whatever it held in memory: the test
 * equivalent of the object being evicted while its document is still unpersisted.
 * The sockets go with it, which is the point — a reconnecting browser is the only
 * way the board comes back.
 */
async function evictBoard(id: string): Promise<void> {
  await evictDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)), {
    webSockets: 'close',
  });
}

describe('a board syncs while both tabs are open', () => {
  it('TC-07: an edit by one client reaches another client that is already open', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    // A creates a note; B's board gains it.
    const note = a.seedNote('hello');
    await b.waitFor(() => b.text(note));
    expect(b.text(note)).toBe('hello');

    // A edits the text; B sees it.
    a.editText(note, 'A');
    await b.waitFor(() => (b.text(note) === 'Ahello' ? true : undefined));

    // And the same in the other direction.
    b.editText(note, 'B');
    await a.waitFor(() => (a.text(note) === 'BAhello' ? true : undefined));
    expect(a.text(note)).toBe(b.text(note));
  });

  it('TC-08: simultaneous text edits merge, and neither editor is sent their own edit back', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    const note = a.seedNote('base');
    await b.waitFor(() => b.text(note));
    // Everything already in flight lands first, so what is counted after an edit is
    // only ever that edit on its way to somebody else.
    await settle(a, b);

    const aSeen = a.frameCount;
    const bSeen = b.frameCount;
    a.editText(note, 'A');
    await b.waitFor(() => (b.text(note)?.includes('A') ? true : undefined));
    expect(updateFrames(b.received.slice(bSeen))).toBe(1);
    expect(updateFrames(await a.collect(300))).toBe(0);

    b.editText(note, 'B');
    await a.waitFor(() => (a.text(note)?.includes('B') ? true : undefined));
    expect(updateFrames(a.received.slice(aSeen))).toBe(1);
    expect(updateFrames(await b.collect(300))).toBe(0);

    // Both inserts are in the one text, in the one order both hold.
    const text = await textConverges(a, b, note);
    expect(text).toContain('base');
    expect(text).toContain('A');
    expect(text).toContain('B');
  });

  it('TC-08: the same field written twice at once resolves to one value, the same one everywhere', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    const note = a.seedNote('base');
    await b.waitFor(() => b.text(note));
    await settle(a, b);

    const aSeen = a.frameCount;
    const bSeen = b.frameCount;
    a.setColor(note, 'blue');
    b.setColor(note, 'green');

    const color = await fieldConverges(a, b, note, 'color');
    expect(['blue', 'green']).toContain(color);
    // Each other client is told once, and neither is handed their own write back.
    expect(updateFrames(a.received.slice(aSeen))).toBe(1);
    expect(updateFrames(b.received.slice(bSeen))).toBe(1);
  });

  it('TC-08: a note deleted while it is being edited stays deleted', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    const note = a.seedNote('base');
    await b.waitFor(() => b.text(note));
    await settle(a, b);

    // Both happen without either seeing the other first.
    a.remove(note);
    b.editText(note, 'too late');

    await until(a, b, () => a.count === 0 && b.count === 0, 'the deleted note is gone from both');
    expect(a.text(note)).toBeUndefined();
    expect(b.text(note)).toBeUndefined();
    // The late edits are not pushed back onto a board that deleted the note.
    expect(updateFrames(await b.collect(300))).toBe(0);
  });

  it('TC-09: a presence update reaches the other editor and not its own sender', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    await settle(a, b);

    a.sendAwareness({ name: 'Ada', x: 10 });

    const frames = await b.collect(500);
    expect(frames.length).toBe(1);
    expect(presenceIn(frames).get(a.clientId)).toEqual({ name: 'Ada', x: 10 });
    // Relayed verbatim: the room changed nothing on the way through.
    expect(frames[0]).toEqual(
      awarenessMessage(awarenessUpdate(a.clientId, 1, { name: 'Ada', x: 10 })),
    );

    // The sender is not sent its own presence.
    expect(presenceIn(await a.collect(500)).has(a.clientId)).toBe(false);
  });

  it('TC-10: a late joiner receives the current board state', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    const first = a.seedNote('first');
    const second = b.seedNote('second');
    await a.waitFor(() => (a.count === 2 ? true : undefined));

    const c = await connectRoom(id);

    await c.waitFor(() => (c.count === 2 ? true : undefined));
    expect(c.text(first)).toBe('first');
    expect(c.text(second)).toBe('second');
  });
});

describe('a connection going away', () => {
  it('TC-11: the room tells the others by removing the presence it knew', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    a.sendAwareness({ name: 'Ada' }, 4);
    b.sendAwareness({ name: 'Bo' });
    await settle(a, b);
    // Each knows the other, so there is something for the room to take away.
    expect(presenceIn(b.received).get(a.clientId)).toEqual({ name: 'Ada' });

    // A's browser goes away.
    a.close();

    // B is told, with the clock the room last saw for A: that is the only form in
    // which a client drops presence it has already accepted.
    const removal = await b.waitFor(() => {
      const entry = presenceWithClocks(b.received).get(a.clientId);
      return entry !== undefined && entry.state === null ? entry : undefined;
    });
    expect(removal.state).toBeNull();
    expect(removal.clock).toBe(4);
    // The removal is about the client that went away: B is not handed its own
    // presence on the way, and its connection is untouched.
    expect(presenceWithClocks(b.received).has(b.clientId)).toBe(false);
    expect(b.closed).toBeNull();
  });

  it('TC-12: a message that is not valid sync data closes that socket with 1003 and the room carries on', async () => {
    const id = boardId();
    const victim = await connectRoom(id);
    const bystander = await connectRoom(id);
    const note = victim.seedNote('still here');
    await bystander.waitFor(() => bystander.text(note));

    // A sync frame whose body is not a Yjs update.
    victim.send(frameMessage(MESSAGE_SYNC, new Uint8Array([2, 9, 254, 253, 252])));

    expect((await victim.untilClosed()).code).toBe(1003);

    // The room and the other connection are unaffected: edits still propagate.
    const later = bystander.seedNote('after');
    const watcher = await connectRoom(id);
    await watcher.waitFor(() => watcher.text(later));
    expect(bystander.closed).toBeNull();
  });

  it('TC-13: an unknown message type is refused without taking the room down', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const stranger = await connectRoom(id);

    // A message type this protocol does not define.
    stranger.send(new Uint8Array([42]));

    // Either refusal the spec allows; what matters is that this socket is the one
    // that pays for it.
    expect((await stranger.untilClosed()).code).toBe(1003);

    // The room survived: a fresh connection still syncs, and edits still flow.
    const survivor = await connectRoom(id);
    const note = survivor.seedNote('room is alive');
    await a.waitFor(() => a.text(note));
    expect(a.text(note)).toBe('room is alive');
  });

  it('TC-14: an empty message does not take the room down', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const sender = await connectRoom(id);

    sender.send(new Uint8Array(0));

    expect((await sender.untilClosed()).code).toBe(1003);

    const survivor = await connectRoom(id);
    const note = survivor.seedNote('still fine');
    await a.waitFor(() => a.text(note));
    expect(a.text(note)).toBe('still fine');
  });
});

describe('a room whose document is gone', () => {
  it('TC-15: the first client back repopulates the room from its own state', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    a.seedNote('unpersisted');
    await a.waitFor(() => (a.count === 1 ? true : undefined));
    a.close();
    await evictBoard(id);

    // A client holding the state connects. Its note was made while it had no
    // connection at all, so everything it knows goes out with the handshake and
    // the room is rebuilt from the client rather than from anything stored.
    const holder = RoomClient.prepared(id);
    const note = holder.seedNote('from a tab that never lost it');
    await holder.open();

    const watcher = await connectRoom(id);
    await watcher.waitFor(() => watcher.text(note));
    expect(watcher.text(note)).toBe('from a tab that never lost it');
  });

  it('TC-16: an empty room accepts its first connection after it went away', async () => {
    const id = boardId();
    const first = await connectRoom(id);
    first.seedNote('before eviction');
    first.close();
    await evictBoard(id);

    const second = await connectRoom(id);
    expect(second.count).toBe(0);
    const fresh = second.seedNote('after eviction');
    await second.waitFor(() => second.text(fresh));

    const third = await connectRoom(id);
    await third.waitFor(() => third.text(fresh));
    expect(third.text(fresh)).toBe('after eviction');
  });
});

describe('presence is kept for the connection', () => {
  it('TC-17: a query is answered with what the room knows about the others', async () => {
    const id = boardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    a.sendAwareness({ name: 'Ada' });
    b.sendAwareness({ name: 'Bo' });
    await b.waitFor(() => (presenceIn(b.received).has(a.clientId) ? true : undefined));

    const c = await connectRoom(id);
    c.queryAwareness();

    const states = presenceIn(await c.collect(500));
    expect(states.get(a.clientId)).toEqual({ name: 'Ada' });
    expect(states.get(b.clientId)).toEqual({ name: 'Bo' });
    expect(states.has(c.clientId)).toBe(false);
  });

  it('TC-18: a query in a room with nobody else is answered with nothing, not with a wait', async () => {
    const id = boardId();
    const only = await connectRoom(id);

    only.queryAwareness();

    expect(await only.collect(500)).toEqual([]);

    // The connection is still good: the board works on afterwards.
    const note = only.seedNote('still connected');
    await only.waitFor(() => only.text(note));
  });
});
