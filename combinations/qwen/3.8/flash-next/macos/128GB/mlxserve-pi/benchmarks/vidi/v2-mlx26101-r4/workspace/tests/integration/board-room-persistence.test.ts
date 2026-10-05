/**
 * A board that is still there when you come back (story 4, persist.room).
 *
 * Real Durable Object, real sockets, real SQLite-backed storage. The TC numbers here are story
 * 4's, from its tasks and design; `board-room.test.ts` uses story 3's numbers, so TC-18 appears
 * twice in this folder meaning two different things — once per story, which is how the specs
 * number them.
 *
 * What these tests hold is the promise the story is named for, in the two places it can break:
 * between a change and its being written down (so a change somebody can see must already be in
 * storage — TC-12, TC-20), and between a board and the next time anybody opens it (so what comes
 * back out of storage is the board that went in — TC-13, TC-18). The rest is what the room says
 * when it cannot keep that promise, because the alternative to saying it is showing a person an
 * empty board and letting them believe it was empty (TC-15, TC-16, TC-26) — or letting them tell
 * other people about a change this board could not save (TC-14).
 */
import { evictDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  connect,
  converge,
  createClient,
  createNote,
  fetchBoard,
  leave,
  moveTo,
  onlyNote,
  recolour,
  settle,
  typeInto,
  upgradeHeaders,
} from './helpers/ws-client';
import { callInternal, inRoom, storedLines, storedNotes, storedStats, stubFor } from './helpers/storage';

/**
 * Connect, and wait to be turned away.
 *
 * Returns the close code, because a refusal is an answer this product gives on purpose: the
 * connection is accepted and then closed with a code that says what is wrong, rather than
 * failing the handshake, which is what lets a browser tell "this board could not be read" from
 * "the network is down".
 */
async function turnedAway(boardId: string, timeoutMs = 5000): Promise<number> {
  const response = await fetchBoard(boardId, { headers: upgradeHeaders() });
  const socket = response.webSocket;
  if (response.status !== 101 || socket === null || socket === undefined) {
    throw new Error(`connecting to board ${boardId} gave ${response.status}, not a connection`);
  }
  const client = createClient(boardId, socket);
  const { code } = await client.waitForClose(timeoutMs);
  return code;
}

describe('a change is stored before anybody is told about it (TC-12)', () => {
  it('has the note in storage by the time a second person can see it', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    try {
      const id = createNote(alex, { x: 40, y: 60 }, 'blue');
      // Sam arrives after the change was made and is told about it — and by then the row is
      // already written, because the room writes before it repeats.
      const sam = await connect(board);
      await converge([alex, sam]);
      expect(onlyNote(sam).id).toBe(id);

      const stats = await storedStats(board);
      expect(stats.updates).toBeGreaterThan(0);
      expect(stats.storageFailures).toBe(0);
      // Read the storage from outside the room, rather than believing what the room says it did.
      expect((await storedNotes(board)).map((note) => note.id)).toContain(id);
      leave(sam);
    } finally {
      leave(alex);
    }
  });

  it('stores every kind of change, not only the one that makes a note exist', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    try {
      const id = createNote(alex, { x: 10, y: 10 }, 'orange');
      typeInto(alex, id, 0, 'Written down ');
      moveTo(alex, id, 300, 40);
      recolour(alex, id, 'green');
      const expected = alex.snapshot();
      await settle();

      // Four changes, and the state this client announced when it arrived, which is stored too:
      // a change a client arrives holding is a change the room writes down, which is how a board
      // gets filled in by the first person who comes back.
      const rows = (await storedStats(board)).updates;
      expect(rows).toBeGreaterThanOrEqual(4);
      // A move that was never written would come back as the note where it started, so this is
      // not one assertion about "the note is there" but four values that each had to survive a
      // round trip through storage.
      expect(await storedNotes(board)).toEqual(expected);
    } finally {
      leave(alex);
    }
  });
});

describe('coming back after everybody has gone (TC-13)', () => {
  it('gives the next person the board that was left', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const id = createNote(alex, { x: 70, y: 20 }, 'violet');
    typeInto(alex, id, 0, 'Left the office like this');
    const left = alex.snapshot();
    leave(alex);
    await settle();

    // The object itself is put away — not merely idle — so what the next person reads cannot be
    // a document that happens to still be in memory. This is the smallest thing that stands in
    // for "overnight", and the story's e2e tests do the same with a real process.
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    const sam = await connect(board);
    try {
      expect(sam.snapshot()).toEqual(left);
      expect(onlyNote(sam).text).toBe('Left the office like this');
      expect((await inRoom(board, (room) => room.state))).toBe('ready');
    } finally {
      leave(sam);
    }
  });

  it('rebuilt the board out of storage, not out of a document that never went away', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    for (const [index, at] of [
      { x: 0, y: 0 },
      { x: 260, y: 40 },
      { x: 520, y: 80 },
    ].entries()) {
      const id = createNote(alex, at, index === 1 ? 'blue' : 'yellow');
      typeInto(alex, id, 0, `Note ${index}`);
    }
    const left = alex.snapshot();
    leave(alex);
    await settle();
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    const sam = await connect(board);
    try {
      // The stacking has to survive too, because folding the log and reading rows back in order
      // is what decides it, not whatever order the previous document happened to hold them in.
      expect(sam.snapshot()).toEqual(left);
      expect(sam.snapshot().map((note) => note.text)).toEqual(['Note 0', 'Note 1', 'Note 2']);
    } finally {
      leave(sam);
    }
  });
});

describe('a change that could not be saved (TC-14)', () => {
  it('is not shown to anybody, and comes back when the person reconnects', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const sam = await connect(board);
    await converge([alex, sam]);

    // The write fails on the way in. Nothing about the failure is known to the room in advance.
    await inRoom(board, (room) => {
      room.store.injectFailure('append');
      return null;
    });
    const id = createNote(alex, { x: 15, y: 15 }, 'blue');

    const [alexClose, samClose] = await Promise.all([alex.waitForClose(), sam.waitForClose()]);
    // Both are told, with the code that says the board could not be saved. A room that carries on
    // after a failed write is a room showing two people different boards.
    expect(alexClose.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(samClose.code).toBe(CLOSE_STORAGE_FAILURE);
    // Sam was never told about the note: broadcasting an unsaved change would be telling Sam
    // their board has something on it that the board cannot keep.
    expect(sam.countOf('update')).toBe(0);
    expect(sam.snapshot()).toEqual([]);
    // The board on disk does not have the note, and says it had a write failure. The rows that
    // are there are the ones that arrived before the failure, which are nobody's problem.
    expect(await storedNotes(board)).toEqual([]);
    const failed = await storedStats(board);
    expect(failed.storageFailures).toBe(1);

    // Alex's screen still holds the note — nobody tells them otherwise, because it is not lost.
    expect(onlyNote(alex).id).toBe(id);
    // The way back in is the ordinary handshake: Alex reconnects with the change still in hand,
    // the room reads its board (which has nothing on it), and Alex's own document fills it in.
    await alex.reconnect(board);
    const samBack = await connect(board);
    try {
      await converge([alex, samBack]);
      expect(onlyNote(samBack).id).toBe(id);
      expect((await storedNotes(board)).map((note) => note.id)).toContain(id);
      expect((await storedStats(board)).storageFailures).toBe(1);
    } finally {
      leave(samBack);
    }
  });
});

describe('a board that cannot be read (TC-15)', () => {
  it('turns a new connection away with the code that says so, and stores nothing for it', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    for (const at of [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 520, y: 0 }]) createNote(alex, at, 'yellow');
    await settle();
    expect(await callInternal(board, 'compact')).toMatchObject({ compacted: true });
    const before = await storedStats(board);
    expect(before.updates).toBe(0);
    expect(before.snapshot.chunks).toBeGreaterThan(0);

    await callInternal(board, 'corrupt-snapshot');
    // The screen does not change, and that is correct rather than a flaw: what was damaged is the
    // copy on disk, and the room is holding a board it read while it was still readable. The
    // damage is found the next time the board has to be read — which is what the rest of this
    // test is about.
    leave(alex);
    await settle();
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    // A new connection is accepted and then closed with a code of its own. The alternative is a
    // connection that succeeds, which is a person being told this board is empty.
    const response = await fetchBoard(board, { headers: upgradeHeaders() });
    expect(response.status).toBe(101);
    const client = createClient(board, response.webSocket as WebSocket);
    // What a client sends in the first moments of a connection, sent here before the refusal
    // arrives: the room must not answer it by writing anything down. A board that stores what a
    // stranger sends it because it could not read itself is a board being rewritten by whoever
    // arrives first.
    client.sendSyncStep1();
    client.sendSyncStep2();
    expect(await client.waitForClose()).toMatchObject({ code: CLOSE_BOARD_LOAD_FAILED });

    const after = await storedStats(board);
    expect(after.updates).toBe(before.updates);
    expect(after.bytes).toBe(before.bytes);
    // The snapshot is the same rows with the same contents — except that the room now knows one
    // of them is not a board, which is what it will say to everyone who asks afterwards.
    expect(after.snapshot.throughSeq).toBe(before.snapshot.throughSeq);
    expect(after.snapshot.chunks).toBe(before.snapshot.chunks);
    expect(after.snapshot.unreadable).toBe(true);
    // Nothing was quarantined either: a load that gave up on a board did not go row by row
    // deciding what to keep.
    expect(after.quarantined).toEqual({ count: 0, bytes: 0 });
  });
});

describe('trying again at a board that would not load (TC-16)', () => {
  it('refuses inside the retry interval without reading storage, and loads once it is repaired', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const id = createNote(alex, { x: 0, y: 0 }, 'blue');
    typeInto(alex, id, 0, 'One note, one snapshot');
    await settle();
    expect(await callInternal(board, 'compact')).toMatchObject({ compacted: true });
    leave(alex);
    await settle();
    await callInternal(board, 'corrupt-snapshot');
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    // The first try: refused, and the refusal is on the record.
    expect(await turnedAway(board)).toBe(CLOSE_BOARD_LOAD_FAILED);
    const attempts = async (): Promise<number> =>
      (await storedLines(board)).filter((line) => line.startsWith('load:')).length;
    const afterFirst = await attempts();
    expect(afterFirst).toBeGreaterThan(0);

    // The second try, immediately, which is what a browser that is reconnecting does. It is
    // refused again — and refused *without* going to storage, which is the whole point of the
    // interval: a board that cannot be read is not made readable by reading it harder.
    expect(await turnedAway(board)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await attempts()).toBe(afterFirst);

    // Put the board back, and wait out the interval: the next person who opens this board gets
    // the board, and nobody had to reload anything.
    expect(await callInternal(board, 'repair')).toMatchObject({ restored: true });
    await settle(LOAD_RETRY_MIN_INTERVAL_MS + 250);
    const sam = await connect(board);
    try {
      expect(onlyNote(sam).text).toBe('One note, one snapshot');
      expect(await attempts()).toBeGreaterThan(afterFirst);
    } finally {
      leave(sam);
    }
  }, LOAD_RETRY_MIN_INTERVAL_MS + 30_000);
});

describe('data that is not a board message (TC-17)', () => {
  it('closes that one connection and leaves the storage alone', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    createNote(alex, { x: 0, y: 0 }, 'yellow');
    await settle();
    const stranger = await connect(board);
    const before = await storedStats(board);
    stranger.sendRaw(new Uint8Array([255, 254, 253, 252, 251]));
    expect(await stranger.waitForClose()).toMatchObject({ code: CLOSE_UNSUPPORTED_DATA });

    // Data that cannot be read is that connection's problem, and it is not written down: a board
    // cannot be corrupted by somebody sending nonsense.
    const after = await storedStats(board);
    expect(after.updates).toBe(before.updates);
    expect(after.bytes).toBe(before.bytes);
    expect(after.quarantined).toEqual({ count: 0, bytes: 0 });
    // The board is still a board, and the person who was here first has not been disturbed.
    expect((await storedNotes(board)).length).toBe(1);
    expect(alex.open).toBe(true);
    leave(alex);
  });
});

describe('a room that was put away while its people stayed (TC-18)', () => {
  it('finds its connections again and carries a change across them', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const sam = await connect(board);
    await converge([alex, sam]);

    // The object is shut down with both sockets still open — which is what hibernation is for: a
    // board nobody is changing costs nothing. What has to survive is not a document but the
    // sockets, which the runtime hands back to whatever object answers next.
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    const id = createNote(alex, { x: 90, y: 30 }, 'green');
    // The message that wakes the room is Alex's. Sam's socket was never closed and never
    // reconnected, and is found through the runtime's list of this object's sockets.
    await converge([alex, sam]);
    expect(onlyNote(sam).id).toBe(id);
    // The room that delivered this had never seen either connection before: it was built by
    // Alex's frame, read the board out of storage, and found both sockets waiting for it.
    expect(await callInternal(board, 'state')).toMatchObject({ sockets: 2, state: 'ready' });
    // And it is in storage, which is the only reason the room was allowed to disappear.
    expect((await storedNotes(board)).map((note) => note.id)).toContain(id);
    leave(alex, sam);
  });

  it('reads the board back for a connection that arrives after it was put away', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const id = createNote(alex, { x: 0, y: 0 }, 'orange');
    await converge([alex]);
    // Sam opens a board whose room has been asleep since before Sam arrived.
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    const sam = await connect(board);
    try {
      // Not a document that never went away: the board Sam is answering from was read out of the
      // log after this object was built.
      expect(onlyNote(sam).id).toBe(id);
      expect(await callInternal(board, 'state')).toMatchObject({ sockets: 2, state: 'ready' });

      typeInto(sam, id, 0, 'From a woken room ');
      await settle();
      // What arrives on a socket that survived is written down like any other change, which is
      // the only reason any of this is allowed to be forgotten between messages.
      expect((await storedNotes(board)).map((note) => note.text)).toContain('From a woken room ');
    } finally {
      leave(sam, alex);
    }
    // What this test cannot claim, and does not: that a message sent to Alex's socket after the
    // room was put away reaches Alex's browser. Whether a hibernated socket still has a person at
    // the other end is the runtime's business — in this runner a socket whose object has been
    // destroyed does not even report itself closed — so what is asserted is the two things the
    // hibernation API is for: the rebuilt room has the sockets it was given, and what arrives on
    // them is stored. TC-18 above is the one that shows a change reaching a socket accepted by an
    // object that no longer exists.
  });
});

describe('a storage read that fails during a load (TC-26)', () => {
  it('turns connections away rather than serving an empty board', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    createNote(alex, { x: 0, y: 0 }, 'blue');
    await settle();
    leave(alex);
    await settle();

    // The read fails in the storage, and keeps failing there: not one statement unhappy in an
    // object that is about to be replaced, but a board that cannot be read. That is what makes
    // this case different from a snapshot whose bytes are nonsense (TC-15) — the statement
    // itself is what throws — and it is the failure with the most tempting wrong answer, because
    // a board with nothing in it looks exactly like a board that loaded and was empty.
    await inRoom(board, (room) => {
      room.store.poisonReads();
      return null;
    });
    // The room is put away after the read was broken, so that what answers the next connection
    // is an object that has to read this board and cannot.
    await evictDurableObject(stubFor(board), { webSockets: 'hibernate' });

    expect(await turnedAway(board)).toBe(CLOSE_BOARD_LOAD_FAILED);
    // The room says which read failed, and says it to everybody: every later connection is told
    // the same thing, rather than being handed an empty board and left to guess.
    expect((await storedLines(board)).some((line) => line.includes('load: failed: sql-error'))).toBe(true);
    expect(await turnedAway(board)).toBe(CLOSE_BOARD_LOAD_FAILED);
    // Nothing was written while it was failing, and nothing was quietly set aside either: a load
    // that could not read the board did not go row by row deciding what to keep.
    expect((await storedStats(board)).storageFailures).toBe(0);
    expect((await storedStats(board)).quarantined).toEqual({ count: 0, bytes: 0 });
    // The rows are where they were: a read that failed is not a board that changed. (Read from
    // the tables rather than by loading a board, which is exactly the thing that is broken.)
    expect((await storedStats(board)).updates).toBeGreaterThan(0);

    // Heal the read, wait out the retry interval, and the board comes back — the storage was
    // never the problem, the reading of it was.
    await inRoom(board, (room) => {
      room.store.healReads();
      return null;
    });
    await settle(LOAD_RETRY_MIN_INTERVAL_MS + 250);
    const sam = await connect(board);
    try {
      expect(sam.snapshot()).toHaveLength(1);
      expect(onlyNote(sam).color).toBe('blue');
      // And the board that could not be read all that time is the board that was written: nothing
      // was lost by failing, which is the whole idea of refusing to serve an empty board.
      expect((await storedNotes(board)).map((note) => note.color)).toEqual(['blue']);
    } finally {
      leave(sam);
    }
  }, LOAD_RETRY_MIN_INTERVAL_MS + 30_000);
});
