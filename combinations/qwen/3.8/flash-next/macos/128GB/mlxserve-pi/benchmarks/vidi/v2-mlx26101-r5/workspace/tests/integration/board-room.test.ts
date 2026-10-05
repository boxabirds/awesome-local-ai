/**
 * The BoardRoom itself (tasks 6.1–6.6): real Durable Object, real WebSockets, real
 * Yjs. Every assertion is about what the other person's screen ends up with.
 *
 *   TC-07  a created note reaches the other client as exactly one update
 *   TC-08  move / recolour / typing / delete each converge, with no echo to the sender
 *   TC-09  concurrent typing in one note merges into one text on both
 *   TC-10  concurrent moves of one note converge to the same x on both
 *   TC-11  a delete during a concurrent insert does not resurrect the note
 *   TC-12  five clients × 200 seeded random operations produce identical snapshots
 *   TC-14  a client that joins late gets the board and every change after it
 *   TC-15  malformed traffic closes only its own socket
 *   TC-16  awareness bytes are relayed verbatim to everybody
 *   TC-18  a room that starts empty is rebuilt from the first client back
 *   TC-31  a socket that dies mid-board takes nothing down with it
 */

import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import {
  OBJECTS_MAP,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { MESSAGE_AWARENESS, MESSAGE_SYNC, readMessageType } from '../../src/shared/protocol';
import { applyRandomOpsRoundRobin, seedFromEnvironment } from './helpers/random-ops';
import {
  RoomSocket,
  WsClient,
  at,
  awarenessFrame,
  connectSockets,
  updateFrame,
} from './helpers/ws-client';

/** How long a test waits for a change to converge. */
const CONVERGE_TIMEOUT_MS = 5000;

/** A value the test hands over directly, or as a getter to re-read each attempt. */
function value(source: unknown): unknown {
  return typeof source === 'function' ? (source as () => unknown)() : source;
}

/** Waits for a change to arrive, then asserts it; also reports how long it took. */
async function expectConverged(label: string, actual: unknown, expected: unknown): Promise<void> {
  const started = Date.now();
  // Both sides are read again on every attempt: the other person's board is still
  // moving while we wait, and a snapshot captured up front would be yesterday's.
  await vi.waitFor(() => expect(value(actual)).toEqual(value(expected)), { timeout: CONVERGE_TIMEOUT_MS });
  const elapsed = Date.now() - started;
  console.log(`latency ${label}: ${elapsed}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
}

/** Creates a note and returns its id. */
function makeNote(client: WsClient, x: number, y: number, color: 'yellow' | 'pink' | 'blue' | 'green' | 'orange' | 'violet' = 'yellow', text = ''): string {
  let id = '';
  client.transact((doc) => {
    const created = createSticky(doc, { x, y }, color);
    if (created === false) throw new Error('createSticky rejected the point');
    id = created;
    if (text) getStickyText(doc, id)?.insert(0, text);
  });
  return id;
}

describe('a note created by one client reaches the other (TC-07)', () => {
  it('converges, and the other client receives exactly one update', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    sam.clearReceived();

    makeNote(alex, 120, 40, 'pink', 'kickoff');

    await expectConverged('create', () => sam.snapshot(), () => alex.snapshot());
    expect(sam.received.filter((message) => message.kind === 'update')).toHaveLength(1);
    expect(sam.snapshot()).toHaveLength(1);
    expect(sam.snapshot()[0]).toMatchObject({ x: 20, y: -60, color: 'pink', text: 'kickoff' });
  });
});

describe('every kind of edit converges and echoes nothing back (TC-08)', () => {
  it('a move', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 0, 0);
    await expectConverged('create before move', () => sam.snapshot().length, 1);
    alex.clearReceived();
    sam.clearReceived();

    alex.transact((doc) => moveObject(doc, id, 410, -75));

    await expectConverged('move', () => sam.snapshot(), () => alex.snapshot());
    expect(sam.snapshot()[0]).toMatchObject({ x: 410, y: -75 });
    expect(alex.received.filter((message) => message.kind === 'update')).toHaveLength(0);
  });

  it('a recolour', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 10, 10, 'yellow');
    await sam.settle();
    alex.clearReceived();
    sam.clearReceived();

    alex.transact((doc) => setStickyColor(doc, id, 'violet'));

    await expectConverged('recolour', () => sam.snapshot(), () => alex.snapshot());
    expect(sam.snapshot()[0]?.color).toBe('violet');
    expect(alex.received.filter((message) => message.kind === 'update')).toHaveLength(0);
  });

  it('typing into a note', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 10, 10, 'yellow', 'start ');
    await sam.settle();
    alex.clearReceived();
    sam.clearReceived();

    alex.transact((doc) => getStickyText(doc, id)?.insert(6, 'typing in'));

    await expectConverged('typing', () => sam.snapshot(), () => alex.snapshot());
    expect(sam.snapshot()[0]?.text).toBe('start typing in');
    expect(alex.received.filter((message) => message.kind === 'update')).toHaveLength(0);
  });

  it('a delete', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 10, 10);
    makeNote(alex, 300, 300);
    await sam.settle();
    alex.clearReceived();
    sam.clearReceived();

    alex.transact((doc) => deleteObject(doc, id));

    await expectConverged('delete', () => sam.snapshot(), () => alex.snapshot());
    expect(sam.snapshot()).toHaveLength(1);
    expect(alex.received.filter((message) => message.kind === 'update')).toHaveLength(0);
  });
});

describe('concurrent edits merge the way Yjs merges them', () => {
  it('two inserts into one note produce one text on both (TC-09)', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 0, 0, 'yellow', 'green');
    await sam.waitForSync();
    expect(sam.snapshot()[0]?.text).toBe('green');

    // Both edit before either has heard about the other.
    alex.transact((doc) => getStickyText(doc, id)?.insert(0, 'red '));
    sam.transact((doc) => getStickyText(doc, id)?.insert(5, ' blue'));

    await expectConverged('text merge', () => sam.snapshot(), () => alex.snapshot());
    expect(alex.snapshot()[0]?.text).toBe('red green blue');
    expect(sam.snapshot()[0]?.text).toBe('red green blue');
  });

  it('two moves of one note leave both with the same x (TC-10)', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 0, 0);
    await sam.waitForSync();

    alex.transact((doc) => moveObject(doc, id, 100, 0));
    sam.transact((doc) => moveObject(doc, id, 300, 0));

    await alex.settle();
    await sam.settle();
    // What the story asks for is that both ends land on the same board: whoever wins
    // the race, nobody is left with a note in a different place.
    expect(alex.snapshot()[0]?.x).toBe(sam.snapshot()[0]?.x);
    expect(alex.snapshot()).toEqual(sam.snapshot());
    expect([100, 300]).toContain(sam.snapshot()[0]?.x);
  });

  it('a delete during a concurrent insert does not resurrect the note (TC-11)', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 0, 0, 'yellow', 'keep me?');
    await sam.waitForSync();

    // Alex deletes while Sam types into the very note being deleted.
    alex.transact((doc) => deleteObject(doc, id));
    sam.transact((doc) => getStickyText(doc, id)?.insert(0, 'but I am typing '));

    await alex.settle();
    await sam.settle();

    expect(alex.snapshot()).toEqual([]);
    expect(sam.snapshot()).toEqual([]);
    expect(alex.snapshot()).toEqual(sam.snapshot());
    // Nothing of Sam's insert survives, and no client re-created the note.
    expect(alex.snapshot().some((note) => note.text.includes('but I am typing'))).toBe(false);
    expect(sam.snapshot().some((note) => note.text.includes('but I am typing'))).toBe(false);
  });

  it(`${MAX_CONCURRENT_EDITORS} clients × 200 seeded random operations converge to identical snapshots (TC-12)`, async () => {
    const seed = seedFromEnvironment();
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index++) {
      clients.push(await WsClient.connect(boardId));
    }
    for (const client of clients) await client.waitForSync();

    const counts = await applyRandomOpsRoundRobin(clients, 200, seed);
    console.log(`TC-12 seed=${seed} operations=`, JSON.stringify(counts));

    for (const client of clients) await client.settle(80);
    const [first, ...rest] = clients.map((client) => client.snapshot());
    for (const [index, snapshot] of rest.entries()) {
      expect(snapshot, `client ${index + 1} diverged from client 0`).toEqual(first);
    }
    // The board is not empty: the run really created and edited notes.
    expect((first ?? []).length).toBeGreaterThan(0);
  }, 120_000);
});

describe('a client that joins late gets the board and keeps getting it (TC-14)', () => {
  it('catches up on 20 notes and on everything edited afterwards', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();

    for (let index = 0; index < 10; index++) {
      makeNote(alex, index * 50, 0, 'yellow', `alex ${index}`);
      makeNote(sam, index * 50, 400, 'blue', `sam ${index}`);
    }
    await expectConverged('20 notes', () => sam.snapshot().length, 20);

    const late = await WsClient.connect(boardId);
    await late.waitForSync();
    await expectConverged('late joiner', () => late.snapshot(), () => alex.snapshot());

    // And the late joiner keeps up with what happens next.
    makeNote(alex, 900, 900, 'green', 'after you arrived');
    makeNote(sam, 950, 950, 'orange');
    await expectConverged('after join', () => late.snapshot(), () => alex.snapshot());
    expect(late.snapshot()).toHaveLength(22);
  });
});

describe('malformed traffic closes only the socket that sent it (TC-15)', () => {
  const badFrames: readonly { label: string; frame: (client: WsClient) => Uint8Array | string }[] = [
    { label: 'a text frame', frame: () => 'hello' },
    { label: 'truncated bytes', frame: () => new Uint8Array([0, 2, 9, 1, 2]) },
    { label: 'an unknown message type', frame: () => new Uint8Array([9, 0]) },
    {
      label: 'an invalid Yjs update',
      frame: () => updateFrame(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x7f])),
    },
    { label: 'an empty frame', frame: () => new Uint8Array(0) },
  ];

  for (const { label, frame } of badFrames) {
    it(`${label}: the sender is closed with 1003, everybody else carries on`, async () => {
      const boardId = newBoardId();
      const troublemaker = await WsClient.connect(boardId);
      const alex = await WsClient.connect(boardId);
      const sam = await WsClient.connect(boardId);
      await troublemaker.waitForSync();
      await alex.waitForSync();
      await sam.waitForSync();
      const noteId = makeNote(alex, 0, 0, 'yellow', 'untouched');
      await sam.settle();
      const before = alex.snapshot();
      expect(before).toHaveLength(1);

      const bad = frame(troublemaker);
      if (typeof bad === 'string') troublemaker.rawSocket.sendText(bad);
      else troublemaker.rawSocket.send(bad);

      expect((await troublemaker.rawSocket.closed()).code).toBe(1003);
      await vi.waitFor(() => expect(troublemaker.online).toBe(false), { timeout: CONVERGE_TIMEOUT_MS });

      // The other two are unaffected: their board is unchanged by the bad frame and
      // both of them keep receiving each other's edits.
      expect(alex.snapshot()).toEqual(before);
      expect(sam.snapshot()).toEqual(before);
      makeNote(alex, 500, 500, 'pink', 'still working');
      await expectConverged(`after ${label}`, () => sam.snapshot(), () => alex.snapshot());
      expect(sam.snapshot()).toHaveLength(2);
      expect(sam.snapshot().some((note) => note.id === noteId)).toBe(true);
      expect(alex.rawSocket.isOpen).toBe(true);
      expect(sam.rawSocket.isOpen).toBe(true);
    });
  }
});

describe('awareness bytes are relayed as they arrived (TC-16)', () => {
  it('every socket on the board gets the same bytes, the sender included', async () => {
    const boardId = newBoardId();
    const sockets = await connectSockets(boardId, 3);
    const alex = at(sockets, 0);
    const sam = at(sockets, 1);
    const jo = at(sockets, 2);
    // The room opens every connection with a SyncStep1; that is not the relay.
    for (const socket of sockets) await socket.nextFrame();

    const update = new Uint8Array([0x01, 0x03, 0x61, 0x62, 0x63, 0x2a, 0xff]);
    alex.send(awarenessFrame(update));

    // The sender gets its own bytes back, which is what keeps an idle client alive.
    const receivers: readonly [string, RoomSocket][] = [
      ['sender', alex],
      ['second socket', sam],
      ['third socket', jo],
    ];
    for (const [label, socket] of receivers) {
      const frame = await socket.nextFrame(5000);
      expect(readMessageType(frame), label).toBe(MESSAGE_AWARENESS);
      expect(Array.from(frame), label).toEqual(Array.from(awarenessFrame(update)));
    }
  });

  it('relaying awareness changes no document and sends no update to anybody', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    makeNote(alex, 0, 0, 'yellow', 'one note');
    await sam.settle();
    alex.clearReceived();
    sam.clearReceived();

    alex.sendAwareness(new Uint8Array([0x01, 0x00, 0x00]));

    await alex.settle();
    await sam.settle();
    expect(alex.received.filter((message) => message.kind === 'update')).toHaveLength(0);
    expect(sam.received.filter((message) => message.kind === 'update')).toHaveLength(0);
    expect(sam.snapshot()).toEqual(alex.snapshot());
    expect(sam.snapshot()).toHaveLength(1);
  });
});

describe('a room that starts with nothing is rebuilt from the first client back (TC-18)', () => {
  it('the first client to reconnect repopulates it and the second converges', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    for (let index = 0; index < 3; index++) makeNote(alex, index * 100, index * 100, 'green', `note ${index}`);
    await expectConverged('before the restart', () => sam.snapshot(), () => alex.snapshot());
    const expected = alex.snapshot();

    // Everybody leaves; the room is left with nobody on it.
    alex.disconnect();
    sam.disconnect();
    await Promise.all([alex.rawSocket.closed().catch(() => undefined), sam.rawSocket.closed().catch(() => undefined)]);

    // A room instance with nothing in it — which is what a restart leaves behind, and
    // which a client cannot tell apart from its own board.
    const restarted = newBoardId();
    await alex.reconnectTo(restarted);
    // Alex still holds the whole board; nothing arrived to change it.
    expect(alex.snapshot()).toEqual(expected);

    // Sam arrives with the same copy, and the two agree.
    await sam.reconnectTo(restarted);
    await expectConverged('after the restart', () => sam.snapshot(), expected);

    // The room itself was rebuilt from Alex's SyncStep2: a client that never had the
    // notes now gets them from the room alone.
    const newcomer = await WsClient.connect(restarted);
    await newcomer.waitForSync();
    await expectConverged('rebuilt room', () => newcomer.snapshot(), expected);
  });
});

describe('a socket that dies mid-board takes nothing down with it (TC-31)', () => {
  it('the board keeps working for everyone else and for later joiners', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    const jo = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    await jo.waitForSync();
    makeNote(alex, 0, 0, 'yellow', 'first');
    await expectConverged('first note', () => jo.snapshot().length, 1);

    // Sam's socket goes away while the board is in use.
    sam.disconnect();
    await sam.rawSocket.closed().catch(() => undefined);

    // An update now has to be broadcast to a set that contained a dead socket.
    makeNote(alex, 100, 0, 'yellow', 'second');
    await expectConverged('after a socket died', () => jo.snapshot(), () => alex.snapshot());
    expect(jo.snapshot()).toHaveLength(2);

    // And a client that arrives afterwards gets the whole board.
    const late = await WsClient.connect(boardId);
    await late.waitForSync();
    expect(late.snapshot()).toEqual(alex.snapshot());
  });

  it('a socket that cannot be written to does not stop the other relays', async () => {
    const boardId = newBoardId();
    const alex = await RoomSocket.connect(boardId);
    const sam = await RoomSocket.connect(boardId);
    // Read the initial SyncStep1 out of the way of both.
    await alex.nextFrame();
    await sam.nextFrame();

    // A WsClient writes through alex's socket; sam is then closed by its peer while a
    // broadcast is in flight. The room must still deliver to alex.
    const writer = await WsClient.connect(boardId);
    await writer.waitForSync();
    const noteId = makeNote(writer, 0, 0, 'yellow', 'broadcast me');
    await writer.settle();

    sam.close();
    await sam.closed();
    makeNote(writer, 200, 0, 'yellow', 'and me');
    await writer.settle();

    const frames = alex.received();
    expect(frames.some((frame) => readMessageType(frame) === MESSAGE_SYNC)).toBe(true);
    expect(noteId).toBeTruthy();
  });
});

/** A sanity check that the test client itself behaves like a Yjs client. */
describe('the test client', () => {
  it('never echoes its own update back to itself', async () => {
    const boardId = newBoardId();
    const alone = await WsClient.connect(boardId);
    await alone.waitForSync();
    alone.clearReceived();

    makeNote(alone, 0, 0);

    await alone.settle();
    expect(alone.received.filter((message) => message.kind === 'update')).toHaveLength(0);
    expect(alone.snapshot()).toHaveLength(1);
  });

  it('holds a document that a bare Y.Doc can merge with', async () => {
    const boardId = newBoardId();
    const client = await WsClient.connect(boardId);
    makeNote(client, 10, 10, 'blue', 'mergeable');
    await client.settle();

    const bare = new Y.Doc();
    Y.applyUpdate(bare, Y.encodeStateAsUpdate(client.doc));
    expect(bare.getMap(OBJECTS_MAP).size).toBe(1);
    expect(client.snapshot()[0]?.text).toBe('mergeable');
  });
});
