// sync.room integration tests: the real BoardRoom Durable Object, real
// WebSockets and real Yjs, driven through the Worker's own route. Nothing here is
// mocked — merging, broadcasting and error handling are exercised the way a
// browser does it.

import { describe, expect, it } from 'vitest';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  createSticky,
  deleteObject,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { applyTextDiff } from '../../src/client/objects/StickyText';
import type { BoardRoom } from '../../src/worker/board-room';
import { RoomClient } from './helpers/ws-client';
import { bindings, roomSnapshot, waitForRoom } from './helpers/room';
import { applyRandomOps, makeRandom, seedNotes } from './helpers/random-ops';

/** The ids of a snapshot, in render order. */
const ids = (notes: readonly StickySnapshot[]): string[] => notes.map((note) => note.id);

/** A note whose text is `text`, created on `client`'s doc and synced to `others`. */
async function noteSyncedTo(
  client: RoomClient,
  others: RoomClient[],
  text = '',
): Promise<string> {
  const id = createSticky(client.doc, { x: 100, y: 200 });
  if (text !== '') {
    const ytext = getStickyText(client.doc, id)!;
    applyTextDiff(ytext, text, LOCAL_ORIGIN);
  }
  for (const other of others) {
    await other.waitForDoc((notes) => notes.some((note) => note.id === id), `synced note ${id}`);
  }
  return id;
}

/** Run `body` inside a transaction, like a real edit does. */
function edit(doc: Y.Doc, body: () => void): void {
  doc.transact(body, LOCAL_ORIGIN);
}

/** Poll `condition` until it holds, or fail with `message`. */
async function waitUntil(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Wait until every listed client renders exactly the same board. */
async function waitForConvergence(clients: RoomClient[]): Promise<string> {
  const rendered = (): Set<string> =>
    new Set(clients.map((client) => JSON.stringify(client.snapshot())));
  await waitUntil(() => rendered().size === 1, 'clients never converged');
  return [...rendered()][0]!;
}

describe('one change reaches everybody (TC-07, TC-08)', () => {
  it('TC-07 shows a new note to the other person as one update', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await a.waitForSync();
    await b.waitForSync();
    const updates = b.frameCount('update');

    const id = createSticky(a.doc, { x: 100, y: 200 });
    const received = await b.waitForNewFrames('update', updates);

    // Exactly one document update arrived, and it carries the whole change.
    expect(received).toHaveLength(1);
    expect(ids(b.snapshot())).toEqual(ids(a.snapshot()));
    expect(b.snapshot()[0]).toMatchObject({
      id,
      x: 100 - STICKY_SIZE_WORLD / 2,
      y: 200 - STICKY_SIZE_WORLD / 2,
      color: 'yellow',
      text: '',
    });

    a.close();
    b.close();
  });

  it('TC-08 moves a note for the other person, with no echo back', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b]);

    const aUpdates = a.frameCount('update');
    const bUpdates = b.frameCount('update');
    expect(moveObject(a.doc, id, 640, 480)).toBe(true);

    await b.waitForDoc((notes) => notes[0]?.x === 640 && notes[0]?.y === 480, 'b saw the move');
    expect(b.snapshot()).toEqual(a.snapshot());
    // A receives no echo of its own change.
    expect(a.frameCount('update')).toBe(aUpdates);
    expect(b.frameCount('update')).toBe(bUpdates + 1);

    a.close();
    b.close();
  });

  it('TC-08 recolours a note for the other person, with no echo back', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b]);

    const aUpdates = a.frameCount('update');
    expect(setStickyColor(a.doc, id, 'pink')).toBe(true);
    await b.waitForDoc((notes) => notes[0]?.color === 'pink', 'b saw the new colour');
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.frameCount('update')).toBe(aUpdates);

    a.close();
    b.close();
  });

  it('TC-08 shows typed text to the other person, with no echo back', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b]);

    const aUpdates = a.frameCount('update');
    const ytext = getStickyText(a.doc, id)!;
    edit(a.doc, () => applyTextDiff(ytext, 'Shipped the board early', LOCAL_ORIGIN));

    await b.waitForDoc((notes) => notes[0]?.text === 'Shipped the board early', 'b saw the text');
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.frameCount('update')).toBe(aUpdates);

    a.close();
    b.close();
  });

  it('TC-08 removes a deleted note for the other person, with no echo back', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b]);

    const aUpdates = a.frameCount('update');
    expect(deleteObject(a.doc, id)).toBe(true);
    await b.waitForDoc((notes) => notes.length === 0, 'b removed the note');
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.snapshot()).toEqual([]);
    expect(a.frameCount('update')).toBe(aUpdates);

    a.close();
    b.close();
  });
});

describe('concurrent edits merge (TC-09, TC-10, TC-11)', () => {
  it('TC-09 keeps both concurrent inserts into the same note', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b], 'green');

    // Both people type before either change can reach the other: A puts "red " in
    // front, B puts " blue" at the end.
    const textA = getStickyText(a.doc, id)!;
    const textB = getStickyText(b.doc, id)!;
    edit(a.doc, () => textA.insert(0, 'red '));
    edit(b.doc, () => textB.insert(textB.length, ' blue'));

    await a.waitForDoc((notes) => notes[0]?.text === 'red green blue', 'a converged');
    await b.waitForDoc((notes) => notes[0]?.text === 'red green blue', 'b converged');
    await waitForConvergence([a, b]);
    expect(a.snapshot()[0]?.text).toBe('red green blue');
    expect((await roomSnapshot(boardId))[0]?.text).toBe('red green blue');

    a.close();
    b.close();
  });

  it('TC-10 settles one position for a concurrent move by both', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b]);

    // Both grab the same note and drop it somewhere else at the same time.
    edit(a.doc, () => moveObject(a.doc, id, 100, 100));
    edit(b.doc, () => moveObject(b.doc, id, 300, 300));

    // One winner, identical on both boards and in the room.
    const settled = await waitForConvergence([a, b]);
    const note = a.snapshot()[0]!;
    expect(JSON.stringify(b.snapshot())).toBe(settled);
    // The winning position is one whole move, not a mix of the two.
    expect([100, 300]).toContain(note.x);
    expect(note.y).toBe(note.x);
    expect((await roomSnapshot(boardId))[0]).toEqual(note);

    a.close();
    b.close();
  });

  it('TC-11 lets a delete win over a concurrent edit inside the note', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const id = await noteSyncedTo(a, [b], 'delete me');

    // A deletes the note while B is typing into it.
    const textB = getStickyText(b.doc, id)!;
    edit(a.doc, () => deleteObject(a.doc, id));
    edit(b.doc, () => textB.insert(textB.length, ' and keep typing'));

    await a.waitForDoc((notes) => notes.length === 0, 'a has no notes');
    await b.waitForDoc((notes) => notes.length === 0, 'b has no notes');
    expect(snapshot(b.doc)).toEqual([]);
    expect(ids(await roomSnapshot(boardId))).toEqual([]);
    // Nobody was thrown out of the room, and nothing arrived as undecodable.
    expect(a.closeCode).toBeNull();
    expect(b.closeCode).toBeNull();
    expect(a.frameCount('invalid')).toBe(0);
    expect(b.frameCount('invalid')).toBe(0);
    // And the board still works afterwards.
    const later = createSticky(a.doc, { x: 10, y: 10 });
    await b.waitForDoc((notes) => notes.some((note) => note.id === later), 'b got the later note');

    a.close();
    b.close();
  });
});

describe('a full room converges (TC-12)', () => {
  it('agrees on every change made by all editors at once', async () => {
    // Logged so a failure can be reproduced exactly.
    const seed = 20260214;
    console.log(`TC-12 seed ${seed}`);
    const boardId = newBoardId();
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await RoomClient.connect(boardId));
    }
    for (const client of clients) await client.waitForSync();

    // One person seeds 20 notes so there is something to fight over, and the rest
    // catch up before anybody starts editing.
    const base = seedNotes(clients[0]!.doc, makeRandom(seed), 20);
    expect(base.length).toBe(20);
    for (const client of clients.slice(1)) {
      await client.waitForDoc((notes) => notes.length === 20, 'everybody has the 20 seeded notes');
    }

    // Then every editor makes 200 random changes without waiting for anybody.
    for (const [index, client] of clients.entries()) {
      const ops = applyRandomOps(client.doc, makeRandom(seed + index + 1), 200, [...base]);
      expect(ops.length).toBeGreaterThan(50);
    }

    // Every board ends up identical, and so does the room's own copy.
    const settled = await waitForConvergence(clients);
    expect(JSON.parse(settled)).toBeInstanceOf(Array);
    expect((JSON.parse(settled) as StickySnapshot[]).length).toBeGreaterThan(0);
    const finalNotes = await waitForRoom(
      boardId,
      (notes) => JSON.stringify(notes) === settled,
      `room never matched the clients (seed ${seed})`,
    );
    expect(JSON.stringify(finalNotes)).toBe(settled);

    for (const client of clients) client.close();
  });
});

describe('late joiners catch up (TC-14)', () => {
  it('gives a person who joins late the whole board', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A and B together make 20 notes.
    const notes: string[] = [];
    for (let i = 0; i < 10; i++) {
      notes.push(createSticky(a.doc, { x: i * 40, y: 0 }, i % 2 ? 'blue' : 'yellow'));
      notes.push(createSticky(b.doc, { x: i * 40, y: 80 }, i % 2 ? 'green' : 'violet'));
    }
    await a.waitForDoc((n) => n.length === 20, 'a has all 20 notes');
    await b.waitForDoc((n) => n.length === 20, 'b has all 20 notes');

    const c = await RoomClient.connect(boardId);
    await c.waitForSync();
    await c.waitForDoc((n) => n.length === 20, 'c has all 20 notes');
    expect(c.snapshot()).toEqual(a.snapshot());
    expect(ids(c.snapshot()).sort()).toEqual(notes.slice().sort());

    a.close();
    b.close();
    c.close();
  });
});

describe('nonsense traffic closes only the sender (TC-15)', () => {
  const badTraffic: Array<[string, () => Uint8Array | string]> = [
    ['a text frame', () => 'hello, are you a board?'],
    ['truncated bytes', () => new Uint8Array([1, 200, 3])],
    ['an unknown message type', () => new Uint8Array([9, 1, 2, 3, 4])],
    [
      'an invalid Yjs update',
      () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
        // A "document update" whose payload is not a Yjs update at all.
        encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
        return encoding.toUint8Array(encoder);
      },
    ],
  ];

  for (const [label, makeBad] of badTraffic) {
    it(`TC-15 closes the sender for ${label} and leaves the room alone`, async () => {
      const boardId = newBoardId();
      const a = await RoomClient.connect(boardId);
      const b = await RoomClient.connect(boardId);
      await a.waitForSync();
      await b.waitForSync();
      expect(ids(await roomSnapshot(boardId))).toEqual([]);

      a.sendBytes(makeBad());

      // The offending socket is closed with 1003 (unsupported data).
      expect(await a.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);
      // The other person is untouched.
      expect(b.closeCode).toBeNull();

      // The room is unchanged by the nonsense, and still works for everybody else.
      const c = await RoomClient.connect(boardId);
      await c.waitForSync();
      const bUpdates = b.frameCount('update');
      const id = createSticky(c.doc, { x: 5, y: 5 });
      await b.waitForNewFrames('update', bUpdates);
      expect(ids(b.snapshot())).toEqual([id]);
      expect(ids(await roomSnapshot(boardId))).toEqual([id]);
      expect(b.closeCode).toBeNull();

      b.close();
      c.close();
    });
  }
});

describe('presence relays without interpretation (TC-16)', () => {
  it('TC-16 gives every socket the identical awareness bytes', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // A announces itself; the room forwards the bytes as they are, A included (the
    // browser provider needs traffic to stay alive). Interpreting them is story 6.
    a.enableAwareness('user', { name: 'Alex' });
    await a.waitForFrames('awareness', 1);
    await b.waitForFrames('awareness', 1);

    const fromA = a.framesOf('awareness')[0]!;
    const fromB = b.framesOf('awareness')[0]!;
    expect(Array.from(fromB.raw)).toEqual(Array.from(fromA.raw));
    expect(fromB.raw.length).toBeGreaterThan(0);
    // The room stored no presence: nobody else hears anything about it later.
    expect(a.awarenessStates().size).toBeLessThanOrEqual(1);

    a.close();
    b.close();
  });
});

describe('a restarted room is rebuilt (TC-18)', () => {
  it('TC-18 refills the room from storage on wake and from whoever reconnects', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const notes: string[] = [];
    for (let i = 0; i < 6; i++) {
      notes.push(createSticky(a.doc, { x: i * 60, y: 0 }, 'orange'));
    }
    await b.waitForDoc((n) => n.length === 6, 'b has the 6 notes');

    // Everybody drops off (a laptop lid closing), then the object goes away. Story 4
    // stores every change before it is broadcast, so a fresh room reads the board
    // straight back out of its own storage — nobody has to be online to save it.
    const saved = a.snapshot();
    a.close();
    b.close();
    await a.waitForClose();
    await b.waitForClose();
    const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
    await evict(stub);
    expect((await roomSnapshot(boardId)).map((n) => n.id)).toEqual(saved.map((n) => n.id));

    // A reconnects — same tab, same document — and converges on the restored board.
    await a.reconnect();
    await a.waitForSync();
    expect(a.snapshot()).toHaveLength(6);
    const aSnapshot = await waitForRoom(
      boardId,
      (current) => JSON.stringify(current) === JSON.stringify(a.snapshot()),
      'the room never matched a\'s board',
    );
    expect(aSnapshot).toEqual(a.snapshot());

    // B reconnects and converges on the same board instead of seeing it empty.
    await b.reconnect();
    await b.waitForSync();
    await waitForConvergence([a, b]);
    expect(b.snapshot()).toEqual(aSnapshot);

    // Somebody opening the board from scratch now gets the restored board too, which
    // proves the room itself holds it and not just the two tabs.
    const late = await RoomClient.connect(boardId);
    await late.waitForSync();
    await late.waitForDoc((n) => n.length === 6, 'the late joiner sees the restored board');
    expect(late.snapshot()).toEqual(aSnapshot);

    a.close();
    b.close();
    late.close();
  });
});

describe('a dead socket cannot break the room (TC-31)', () => {
  it('TC-31 keeps broadcasting after a socket died mid-update', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // B's connection dies without a handshake: the room still holds the socket and
    // is about to write to it while A makes a change.
    const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
    const sizeWhileDead = await runInDurableObject(stub, (instance: BoardRoom) => {
      const room = instance as unknown as {
        ctx: { getWebSockets: () => WebSocket[] };
        roomDoc: Y.Doc;
      };
      const sockets = [...room.ctx.getWebSockets()];
      const dead = sockets[sockets.length - 1]!;
      dead.close(); // now unusable, but the room has not noticed yet
      // A's change arrives in the same turn: the broadcast hits the dead socket.
      createSticky(room.roomDoc, { x: 11, y: 11 }, 'blue');
      return room.ctx.getWebSockets().length;
    });
    expect(sizeWhileDead).toBeGreaterThan(0);

    // The room is unharmed: the note written while one socket was dead is in it.
    const written = await waitForRoom(
      boardId,
      (notes) => notes.length === 1,
      'the room lost the note written while a socket was dead',
    );

    // The dead socket is gone for the client it belonged to, and exactly one client
    // is still connected: writing to a dead socket took the room down for nobody.
    await settle();
    const survivors = [a, b].filter((c) => c.closeCode === null);
    expect(survivors).toHaveLength(1);
    const survivor = survivors[0]!;

    // ...and a socket opened afterwards still receives everything.
    const c = await RoomClient.connect(boardId);
    await c.waitForSync();
    await c.waitForDoc((notes) => notes.length === 1, 'c caught up');
    expect(c.snapshot()).toEqual(written);

    const cUpdates = c.frameCount('update');
    const later = createSticky(survivor.doc, { x: 22, y: 22 });
    await c.waitForNewFrames('update', cUpdates);
    expect(ids(c.snapshot())).toContain(later);

    survivor.close();
    c.close();
  });
});

/** Let the runtime deliver pending socket close events. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/** Drop the object so the next request gets a fresh instance (no persistence yet). */
async function evict(stub: DurableObjectStub): Promise<void> {
  await evictDurableObject(stub, { webSockets: 'close' });
}
