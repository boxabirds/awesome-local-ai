import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, encodeFrame } from '../../src/shared/protocol';
import { formatOps, runRandomOps, seededRandom } from './random-ops';
import { RoomClient, waitForConvergence } from './ws-client';

/**
 * sync.room (TC-07 to TC-16, TC-18, TC-31): real Durable Object, real WebSockets,
 * real Yjs documents. The board is only ever edited through the functions the UI
 * calls, so what converges here is what a workshop would see.
 */

/** Two clients that have exchanged everything they have. */
async function pair(boardId = RoomClient.newBoardId()): Promise<[RoomClient, RoomClient]> {
  const a = await RoomClient.connect(boardId, 'A');
  const b = await RoomClient.connect(boardId, 'B');
  await a.waitForSync();
  await b.waitForSync();
  await waitForConvergence([a, b]);
  return [a, b];
}

/** One seeded note, plus the two clients that already agree it exists. */
async function pairWithNote(): Promise<{ a: RoomClient; b: RoomClient; id: string }> {
  const [a, b] = await pair();
  const id = createSticky(a.doc, { x: 500, y: 300 });
  await waitForConvergence([a, b]);
  expect(a.notes).toHaveLength(1);
  a.clearLog();
  b.clearLog();
  return { a, b, id };
}

describe('relay a single change (TC-07, TC-08)', () => {
  it('TC-07: a created note reaches the other client as exactly one update', async () => {
    const [a, b] = await pair();
    a.clearLog();
    b.clearLog();

    const id = createSticky(a.doc, { x: 240, y: 180 });
    await b.waitFor(() => b.notes.length === 1, 'B sees A note');

    expect(b.notes).toEqual(a.notes);
    expect(b.notes[0]?.id).toBe(id);
    // One document update is all the traffic a single change costs.
    expect(b.updates).toHaveLength(1);
    expect(b.frames).toHaveLength(1);
    a.destroy();
    b.destroy();
  });

  const mutations = {
    move: (id: string, doc: Y.Doc) => moveObject(doc, id, 84, 96),
    recolour: (id: string, doc: Y.Doc) => setStickyColor(doc, id, 'teal'),
    'text insert': (id: string, doc: Y.Doc) => getStickyText(doc, id)?.insert(0, 'harbour '),
    delete: (id: string, doc: Y.Doc) => deleteObject(doc, id),
  } as const;

  for (const [name, mutate] of Object.entries(mutations)) {
    it(`TC-08: "${name}" reaches the other client and never echoes back`, async () => {
      const { a, b, id } = await pairWithNote();
      mutate(id, a.doc);
      await b.waitFor(() => b.state === a.state, `B mirrors A's ${name}`);
      expect(b.notes).toEqual(a.notes);
      // The sender never sees its own change come back (no echo, no loop).
      expect(a.updates).toHaveLength(0);
      expect(a.frames).toHaveLength(0);
      a.destroy();
      b.destroy();
    });
  }
});

describe('concurrent edits merge (TC-09, TC-10, TC-11)', () => {
  it('TC-09: concurrent text inserts are both kept', async () => {
    const { a, b, id } = await pairWithNote();
    const text = getStickyText(a.doc, id)!;
    text.insert(0, 'green');
    await waitForConvergence([a, b]);
    expect(getStickyText(b.doc, id)!.toString()).toBe('green');

    // Both type while their sockets are down, then reconnect and exchange.
    a.disconnect();
    b.disconnect();
    getStickyText(a.doc, id)!.insert(0, 'red '); // A -> "red green"
    getStickyText(b.doc, id)!.insert(5, ' blue'); // B -> "green blue"
    await a.reconnect();
    await b.reconnect();
    await a.waitForSync();
    await b.waitForSync();

    await waitForConvergence([a, b]);
    expect(getStickyText(a.doc, id)!.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)!.toString()).toBe('red green blue');
    a.destroy();
    b.destroy();
  });

  it('TC-10: concurrent positions on one note settle on the same value everywhere', async () => {
    const { a, b, id } = await pairWithNote();
    a.disconnect();
    b.disconnect();
    moveObject(a.doc, id, 100, 100);
    moveObject(b.doc, id, 300, 300);
    await a.reconnect();
    await b.reconnect();
    await a.waitForSync();
    await b.waitForSync();

    await waitForConvergence([a, b]);
    const xOf = (client: RoomClient) => client.notes.find((note) => note.id === id)?.x;
    expect(xOf(a)).toBe(xOf(b)); // one winner, identical on both
    expect([100, 300]).toContain(xOf(a));
    a.destroy();
    b.destroy();
  });

  it('TC-11: a delete during remote typing cannot be undone by that typing', async () => {
    const { a, b, id } = await pairWithNote();
    a.disconnect();
    b.disconnect();
    deleteObject(a.doc, id); // A deletes
    getStickyText(b.doc, id)!.insert(0, 'typing while it vanished'); // B keeps typing
    await a.reconnect();
    await b.reconnect();
    await a.waitForSync();
    await b.waitForSync();

    await waitForConvergence([a, b]);
    expect(a.notes).toHaveLength(0);
    expect(b.notes).toHaveLength(0); // no resurrection on either replica
    expect(getStickyText(a.doc, id)).toBeUndefined();
    expect(getStickyText(b.doc, id)).toBeUndefined();
    // The room took the odd transaction without ill effects: it still relays.
    const survivor = createSticky(a.doc, { x: 40, y: 40 });
    await b.waitFor(() => b.notes.some((note) => note.id === survivor), 'room still relaying');
    a.destroy();
    b.destroy();
  });
});

describe('many clients, many ops (TC-12, TC-14)', () => {
  it('TC-12: every client ends with an identical snapshot after 200 random ops each', async () => {
    const boardId = RoomClient.newBoardId();
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await RoomClient.connect(boardId, `r${i}`));
      await clients[clients.length - 1]!.waitForSync();
    }

    const logs = clients.map((client, i) => {
      const seed = 1_000_003 + i * 7_919; // logged, so a failure is replayable
      return runRandomOps(client.doc, 200, seededRandom(seed), seed);
    });
    console.log(
      'TC-12 seeds:',
      logs.map((log) => formatOps(log, 0)).join(' | '),
    );

    const reference = clients[0]!;
    await waitForConvergence(clients);
    const expected = reference.notes;
    for (const client of clients) {
      expect(client.notes).toEqual(expected);
    }
    expect(expected.length).toBeGreaterThan(0); // the stream really built a board
    for (const client of clients) client.destroy();
  });

  it('TC-14: a client that joins late receives the whole board', async () => {
    const boardId = RoomClient.newBoardId();
    const [a, b] = await pair(boardId);
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * STICKY_SIZE_WORLD, y: 0 });
      createSticky(b.doc, { x: 0, y: i * STICKY_SIZE_WORLD });
    }
    await waitForConvergence([a, b]);
    expect(a.notes).toHaveLength(20);

    const late = await RoomClient.connect(boardId, 'C');
    await late.waitForSync();
    await late.waitFor(() => late.notes.length === 20, 'C received the whole board');
    expect(late.notes).toEqual(a.notes);
    a.destroy();
    b.destroy();
    late.destroy();
  });
});

describe('malformed and idle traffic (TC-15, TC-16)', () => {
  // Four separate runs: each one bad frame closes only the socket that sent it.
  const badFrames = {
    'a text frame': (client: RoomClient) => client.sendText('{"help":"me"}'),
    'truncated bytes': (client: RoomClient) => {
      const frame = syncUpdateFrameOf(Y.encodeStateAsUpdate(client.doc));
      client.sendRaw(frame.subarray(0, frame.length - 6));
    },
    'an unknown message type': (client: RoomClient) =>
      client.sendRaw(encodeFrame(9, Uint8Array.from([7, 7, 7]))),
    'an undecodable Yjs update': (client: RoomClient) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      client.sendRaw(encoding.toUint8Array(encoder));
    },
  } as const;

  for (const [what, send] of Object.entries(badFrames)) {
    it(`TC-15: ${what} closes only that socket`, async () => {
      const boardId = RoomClient.newBoardId();
      const [offender, other] = await pair(boardId);
      const witness = await RoomClient.connect(boardId, 'C');
      await witness.waitForSync();
      other.clearLog();
      witness.clearLog();

      send(offender);
      const closed = await offender.closed();
      expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

      // The room is unchanged and still working for everybody else.
      expect(other.notes).toEqual(witness.notes);
      expect(witness.notes).toHaveLength(0);
      const id = createSticky(other.doc, { x: 60, y: 60 });
      await witness.waitFor(() => witness.notes.some((note) => note.id === id), 'room still relays');
      expect(offender.notes).toHaveLength(0);

      offender.destroy();
      other.destroy();
      witness.destroy();
    });
  }

  it('TC-16: awareness bytes are relayed verbatim to everyone, sender included', async () => {
    const [a, b] = await pair();
    a.clearLog();
    b.clearLog();

    // `setLocalStateField` is what the provider would call for a cursor (story 6).
    a.awareness.setLocalStateField('selection', { noteId: 'anything' });
    await b.waitFor(() => b.awarenessFrames.length > 0, 'B receives awareness');
    await a.waitFor(() => a.awarenessFrames.length > 0, 'A receives its own awareness back');

    const sentByA = a.sent.filter((frame) => frame[0] === 1); // MESSAGE_AWARENESS
    expect(sentByA.length).toBeGreaterThan(0);
    for (const client of [a, b]) {
      const received = client.frames.filter((frame) => frame.type === 1).map((frame) => frame.bytes);
      expect(received.length).toBeGreaterThan(0);
      // Byte-for-byte: the room added, removed and reordered nothing.
      for (const frame of received) {
        expect(sentByA.some((sent) => sameBytes(sent, frame))).toBe(true);
      }
    }
    // The room never interpreted it: B's awareness has A's state, untouched.
    expect(JSON.stringify(b.awareness.getStates().get(a.doc.clientID))).toBe(
      JSON.stringify(a.awareness.getLocalState()),
    );
    a.destroy();
    b.destroy();
  });
});

describe('sockets come and go (TC-18, TC-31)', () => {
  it('TC-18: after a restart the first client back repopulates the room', async () => {
    const [a, b] = await pair();
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i * 60, y: 12 });
    await waitForConvergence([a, b]);
    const before = a.state;

    // The runtime dies: every socket goes and the room object is gone with it.
    a.disconnect();
    b.disconnect();
    // A fresh room instance under a fresh id, which is what the runtime hands out
    // after a restart: no document, no sockets, and the same route.
    const restarted = RoomClient.newBoardId();
    await a.reconnect(restarted);
    await a.waitForSync();
    await a.waitFor(() => a.notes.length === 3, 'A kept its board across the restart');

    // A answered the room's SyncStep1 with everything it had, so the room itself
    // now holds the board: a brand-new client proves it without A's help.
    const probe = await RoomClient.connect(restarted, 'probe');
    await probe.waitForSync();
    await probe.waitFor(() => probe.notes.length === 3, 'room doc rebuilt from A');
    expect(probe.notes).toEqual(a.notes);

    await b.reconnect(restarted);
    await b.waitForSync();
    await waitForConvergence([a, b, probe]);
    expect(b.state).toBe(before);
    expect(a.state).toBe(before);
    a.destroy();
    b.destroy();
    probe.destroy();
  });

  it('TC-31: a socket that vanished mid-flight cannot break the room', async () => {
    const boardId = RoomClient.newBoardId();
    const [a, b] = await pair(boardId);
    const witness = await RoomClient.connect(boardId, 'C');
    await witness.waitForSync();

    // B's socket disappears without a close handshake: the room still has it in
    // its set when the next broadcast happens.
    b.socket?.close();
    const id = createSticky(a.doc, { x: 80, y: 80 });
    await witness.waitFor(() => witness.notes.some((note) => note.id === id), 'broadcast survived');

    // And the room still admits and serves newcomers afterwards.
    const late = await RoomClient.connect(boardId, 'D');
    await late.waitForSync();
    await late.waitFor(() => late.notes.some((note) => note.id === id), 'late joiner caught up');
    const second = createSticky(witness.doc, { x: 90, y: 90 });
    await late.waitFor(() => late.notes.some((note) => note.id === second), 'late joiner still live');

    a.destroy();
    b.destroy();
    witness.destroy();
    late.destroy();
  });
});

/** A well-formed sync frame carrying `update`, as a client would send it. */
function syncUpdateFrameOf(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);
