/**
 * A board that stays there.
 *
 * These are the story-4 tests at the level the story is told: a real WebSocket client with a
 * real `Y.Doc`, a real Durable Object, that object's real SQLite. Nothing is mocked — when a
 * test says "the change was in the database before anybody could see it", it is reading the
 * database the room writes to, and when it says "the room closed the connection with 4500",
 * that is the close code the client's `close` event carries.
 *
 * The seam is `tests/integration/helpers/room-control.ts`: `env.BOARD_ROOM.get(idFromName(id))`
 * is the same room object the sockets are connected to, which the first test asserts rather
 * than assumes, because every other claim in this file depends on it.
 *
 *  - TC-12 a change is written down before anybody can see it
 *  - TC-13 everybody leaves, the room forgets, the next person finds the board
 *  - TC-14 a change that could not be written down is not shown to anybody (1011)
 *  - TC-15 a board whose snapshot cannot be read is refused, not served empty (4500)
 *  - TC-16 both sides of the retry interval on a board that could not be read
 *  - TC-17 a change that is not a change is refused, and costs nothing
 *  - TC-18 a room that lost its memory keeps the connections it had
 *  - TC-26 a read that fails in SQL closes clients with 4500 and damages nothing
 *
 * Two cases the design lists as part of the same behaviour are here too, because they are the
 * ones a reader asks about next: the room folding a full log (the state it passes through on
 * the way), and a board with one damaged change in the log still being served.
 */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  getStickyText,
  isStickySnapshot,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { COMPACTION_UPDATE_COUNT } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import {
  comparable,
  retroBoard,
  scrambledUpdate,
  truncatedUpdate,
} from '../fixtures/boards';
import {
  corruptSnapshot,
  enableStorageHooks,
  forgetTheBoard,
  inRoom,
  logRows,
  quarantinedCount,
  quarantinedRecords,
  readStoredBoard,
  repairSnapshot,
  roomNotes,
  roomStateOf,
  scrambleLogRow,
  setLoadRetryInterval,
  snapshotInfo,
  watchStatements,
  type HookResult,
} from './helpers/room-control';
import { WsClient, updateFrame } from './helpers/ws-client';
import type { FaultPoint } from '../../src/worker/board-store';
import type { StickyColor } from '../../src/shared/config';

/** Lets the room's close handlers and reloads catch up with a client's frames. */
const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Notes on the board the fixture writes, so a test can name a board instead of a number. */
const RETRO_NOTES = 25;

/** One note, made the way the client makes one. */
function note(text: string, color: StickyColor = 'pink'): (doc: Y.Doc) => void {
  return (doc: Y.Doc) => {
    const created = createSticky(doc, { x: 40, y: 60 }, color);
    if (created === false) throw new Error('the test pointed at somewhere that was not a coordinate');
    getStickyText(doc, created)?.insert(0, text);
  };
}

/**
 * Sends a whole fixture board as the client would have made it: one frame per change. Takes the
 * updates rather than a fixture so a test can hand it a log built another way.
 */
async function seed(client: WsClient, updates: readonly Uint8Array[]): Promise<void> {
  for (const update of updates) {
    client.transact((doc) => {
      Y.applyUpdate(doc, update);
    });
  }
  await vi.waitFor(
    async () => {
      expect((await logRows(client.boardId)).length).toBe(updates.length);
    },
    { timeout: 20_000 },
  );
}

/** The note holding `text`, if this board has one. */
function noteWith(notes: readonly StickySnapshot[], text: string): StickySnapshot | undefined {
  return notes.find((note) => note.text === text);
}

/**
 * Waits until the room has taken in every frame the client sent. A client's `transact` returns
 * as soon as the frame is on the wire, and the room handles one message at a time, so a test
 * that changes 500 notes in a loop has to let the room finish the queue before it can say
 * anything true about what the room holds or what storage holds.
 */
async function theRoomHasCaughtUp(client: WsClient): Promise<void> {
  await vi.waitFor(
    async () => {
      const held = await roomNotes(client.boardId);
      expect(comparable(held ?? [])).toEqual(comparable(client.snapshot()));
    },
    { timeout: 20_000, interval: 25 },
  );
}

/** Flips one note's colour: a change that is always a change. */
function flipOne(id: string): (doc: Y.Doc) => void {
  return (doc: Y.Doc) => {
    const note = snapshot(doc).find((candidate) => candidate.id === id);
    // A board holds objects, of which a note is one kind; the colour this test flips belongs to the
    // note kind, so a thing that is not a note is as good as not being on the board here.
    if (!note || !isStickySnapshot(note)) throw new Error(`note ${id} is not on the board`);
    setStickyColor(doc, id, note.color === 'yellow' ? 'orange' : 'yellow');
  };
}

/**
 * Makes changes until the room folds the log, by making the changes that make it fold: the room
 * compacts on the change that reaches `COMPACTION_UPDATE_COUNT`, so this recolours notes back
 * and forth until a snapshot appears, letting the room keep up as it goes. There is no shortcut
 * taken here — this is the room's own compaction, on the room's own document, triggered by the
 * same threshold the product uses.
 */
async function fillTheLog(client: WsClient): Promise<number> {
  const boardId = client.boardId;
  const ids = snapshot(client.doc).map((note) => note.id);
  if (ids.length === 0) throw new Error('there are no notes to recolour');
  const perRound = 50;
  let flips = 0;
  for (let round = 0; round < 40; round++) {
    for (let index = 0; index < perRound; index++) {
      client.transact(flipOne(ids[flips % ids.length] as string));
      flips += 1;
    }
    await theRoomHasCaughtUp(client);
    if ((await snapshotInfo(boardId)).chunks > 0) return flips;
  }
  throw new Error(`the log did not fold after ${String(flips)} changes`);
}

/** A board that was written down and then damaged on purpose, with what it held. */
interface BrokenBoard {
  boardId: string;
  /**
   * The board as it stood when the snapshot was damaged — which is the fixture's notes with
   * the colours the compaction test gave them, so a test compares against this rather than
   * against the colours the fixture started with.
   */
  notes: readonly StickySnapshot[];
  corrupt: HookResult;
}

/**
 * Writes a board down into a snapshot, then damages that snapshot and puts the room where a
 * restart would have left it: no document in memory, everybody connected closed with 4500.
 */
async function brokenBoard(): Promise<BrokenBoard> {
  const boardId = newBoardId();
  const board = retroBoard();
  await enableStorageHooks(boardId);
  const client = await WsClient.connect(boardId);
  await client.waitForSync();
  for (const update of board.updates) {
    client.transact((doc) => {
      Y.applyUpdate(doc, update);
    });
  }
  await vi.waitFor(() => expect(client.snapshot().length).toBe(RETRO_NOTES), { timeout: 20_000 });
  await fillTheLog(client);
  expect((await snapshotInfo(boardId)).chunks).toBeGreaterThan(0);

  const notes = client.snapshot();
  const corrupt = await corruptSnapshot(boardId);
  const closed = await client.rawSocket.closed();
  expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
  return { boardId, notes, corrupt };
}

describe('the room a socket is connected to', () => {
  it('is the room the namespace hands out, holding the board the clients hold (TC-12)', async () => {
    const boardId = newBoardId();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();

    expect(await roomStateOf(boardId)).toBe('ready');
    expect(await roomNotes(boardId)).toEqual([]);

    client.transact(note('the room we are talking to'));
    await client.settle();

    // The document the room is serving from is visible here, with the change in it: this is
    // the seam every test in this file stands on.
    const held = await roomNotes(boardId);
    expect(held?.length).toBe(1);
    expect(noteWith(held ?? [], 'the room we are talking to')).toBeDefined();

    client.disconnect();
    await settle();
    expect(await roomStateOf(boardId)).toBe('hibernated');
  });
});

describe('a change is written down before anybody can see it (TC-12)', () => {
  it('is in the database at the moment the other person receives it', async () => {
    const boardId = newBoardId();
    const author = await WsClient.connect(boardId);
    const watcher = await WsClient.connect(boardId);
    await author.waitForSync();
    await watcher.waitForSync();

    // Watches the room's own write: at the instant the row goes in, how many frames has the
    // other person's socket received? If storing came before broadcasting, none.
    const framesAtWrite: number[] = [];
    const framesBeforeTheChange = watcher.rawSocket.frames.length;
    await inRoom(boardId, (_room, store) => {
      const previous = store.inject;
      store.inject = (point: FaultPoint): void => {
        previous(point);
        if (point === 'append') framesAtWrite.push(watcher.rawSocket.frames.length);
      };
    });
    author.transact(note('saved before it is shared'));
    await vi.waitFor(() => expect(watcher.snapshot().length).toBe(1), { timeout: 10_000 });

    // Both of them had already been answered by the room when the watch started, so what
    // matters is that the row went in while the watcher's socket had received nothing new —
    // and that the frame carrying the change is the one that came after it.
    expect(framesAtWrite).toEqual([framesBeforeTheChange]);
    expect(watcher.rawSocket.frames.length).toBe(framesBeforeTheChange + 1);

    const rows = await logRows(boardId);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { bytes: number }).bytes).toBeGreaterThan(0);
    expect(await quarantinedCount(boardId)).toBe(0);

    // What is in storage is the board both clients are looking at.
    const stored = await readStoredBoard(boardId);
    expect(stored.result.ok).toBe(true);
    expect(comparable(stored.notes)).toEqual(comparable(watcher.snapshot()));

    author.disconnect();
    watcher.disconnect();
  });

  it('keeps one row per change, in the order the changes were made', async () => {
    const boardId = newBoardId();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();

    for (let index = 0; index < 5; index++) {
      client.transact(note(`change number ${String(index)}`, 'blue'));
    }
    await client.settle();

    const rows = await logRows(boardId);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_row, index) => index + 1));
    const stored = await readStoredBoard(boardId);
    expect(stored.notes.map((note) => note.text)).toEqual([
      'change number 0',
      'change number 1',
      'change number 2',
      'change number 3',
      'change number 4',
    ]);

    client.disconnect();
  });
});

describe('everybody leaves and the board stays (TC-13)', () => {
  it('gives the next person the same board, after the room forgot it', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const first = await WsClient.connect(boardId);
    await first.waitForSync();
    for (const update of board.updates) {
      first.transact((doc) => {
        Y.applyUpdate(doc, update);
      });
    }
    await vi.waitFor(() => expect(first.snapshot().length).toBe(RETRO_NOTES), { timeout: 20_000 });

    const second = await WsClient.connect(boardId);
    await second.waitForSync();
    expect(comparable(second.snapshot())).toEqual(comparable(board.notes));

    // Everybody goes. The room notes that there is nobody left to serve.
    first.disconnect();
    second.disconnect();
    await vi.waitFor(() => expect(roomStateOf(boardId)).resolves.toBe('hibernated'), {
      timeout: 10_000,
    });

    // The room loses its memory, which is what an eviction does to it. The board is not lost,
    // because the board is in storage.
    await forgetTheBoard(boardId);
    expect(await roomNotes(boardId)).toBeNull();

    // Somebody who was here an hour ago comes back, and somebody who has never been here.
    await first.reconnect();
    await first.waitForSync();
    expect(comparable(first.snapshot())).toEqual(comparable(board.notes));

    const newcomer = await WsClient.connect(boardId);
    await newcomer.waitForSync();
    expect(comparable(newcomer.snapshot())).toEqual(comparable(board.notes));
    expect(await roomStateOf(boardId)).toBe('ready');

    // A change made now is seen by both of them and written down for the next person.
    newcomer.transact(note('after everybody came back'));
    await vi.waitFor(() => expect(first.snapshot().length).toBe(RETRO_NOTES + 1), {
      timeout: 10_000,
    });
    const stored = await readStoredBoard(boardId);
    expect(noteWith(stored.notes, 'after everybody came back')).toBeDefined();

    first.disconnect();
    newcomer.disconnect();
  });
});

describe('a change that could not be written down (TC-14)', () => {
  it('is not shown to anybody, and is saved when the author comes back', async () => {
    const boardId = newBoardId();
    const author = await WsClient.connect(boardId);
    const other = await WsClient.connect(boardId);
    await author.waitForSync();
    await other.waitForSync();

    await inRoom(boardId, (_room, store) => {
      const previous = store.inject;
      let armed = true;
      store.inject = (point: FaultPoint): void => {
        previous(point);
        if (armed && point === 'append') {
          armed = false;
          throw new Error('the disk is not listening');
        }
      };
    });

    other.clearReceived();
    author.transact(note('the change that could not be saved'));

    // Both are told: a board that could not be written to is not a board to keep editing.
    const authorClose = await author.rawSocket.closed();
    const otherClose = await other.rawSocket.closed();
    expect(authorClose.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(otherClose.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(authorClose.reason).toBe('the board could not be saved');

    // The change never reached the other person, and never reached storage.
    expect(other.received.filter((message) => message.kind === 'update')).toEqual([]);
    expect(noteWith(other.snapshot(), 'the change that could not be saved')).toBeUndefined();
    expect((await readStoredBoard(boardId)).notes).toEqual([]);
    expect(await roomStateOf(boardId)).toBe('storage-failed');

    // Both come back. The author still holds the change, and brings it with it: SyncStep1
    // from the room asks for what the room is missing, and that is how a change that could not
    // be saved the first time gets saved the second.
    await author.reconnect();
    await author.waitForSync();
    await other.reconnect();
    await other.waitForSync();

    expect(await roomStateOf(boardId)).toBe('ready');
    expect(noteWith(other.snapshot(), 'the change that could not be saved')).toBeDefined();
    const stored = await readStoredBoard(boardId);
    expect(stored.notes.map((note) => note.text)).toEqual(['the change that could not be saved']);
    expect(await logRows(boardId)).toHaveLength(1);

    author.disconnect();
    other.disconnect();
  });
});

describe('a board that cannot be read is refused, not served empty (TC-15)', () => {
  it('closes the person on the board with 4500, and every newcomer after them', async () => {
    const { boardId, corrupt } = await brokenBoard();
    expect(corrupt.status).toBe(200);

    // Storage really is unreadable now, and the room knows it.
    const loaded = await readStoredBoard(boardId);
    expect(loaded.result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    expect(await roomStateOf(boardId)).toBe('load-failed');

    const rows = await logRows(boardId);
    const rowsBefore = rows.length;

    // The room does not hand out an empty board: it refuses, in a way the client can say so.
    const newcomer = await WsClient.connect(boardId);
    const closed = await newcomer.rawSocket.closed();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(closed.reason).toBe('this board could not be loaded');

    // Nothing the newcomer sent was stored: it was refused before its state was looked at.
    expect(await logRows(boardId)).toHaveLength(rowsBefore);
    expect(await quarantinedCount(boardId)).toBe(0);
    expect(await roomNotes(boardId)).toBeNull();

    newcomer.disconnect();
  });
});

describe('the retry interval on a board that could not be read (TC-16)', () => {
  it('refuses without reading before the interval, and serves after it', async () => {
    const { boardId, notes } = await brokenBoard();
    const attempted: FaultPoint[] = [];
    await watchStatements(boardId, attempted);

    const repaired = await repairSnapshot(boardId);
    expect(repaired.status).toBe(200);
    expect(repaired.body).toMatchObject({ ok: true, repaired: 1 });

    // The snapshot is whole again, but the room is inside its retry interval, so it does not
    // even look: a board whose storage had a bad minute is not poked once per arriving client.
    await setLoadRetryInterval(boardId, 400);
    const tooSoon = await WsClient.connect(boardId);
    const refused = await tooSoon.rawSocket.closed();
    expect(refused.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(attempted.filter((point) => point.startsWith('load:'))).toEqual([]);
    expect(await roomStateOf(boardId)).toBe('load-failed');

    // Past the interval, the next connection reads the board and is served as if nothing
    // happened — which, from the board's side of things, nothing did.
    await settle(500);
    const latecomer = await WsClient.connect(boardId);
    await latecomer.waitForSync();
    expect(comparable(latecomer.snapshot())).toEqual(comparable(notes));
    expect(await roomStateOf(boardId)).toBe('ready');
    expect(attempted).toContain('load:select-updates');

    // And the board is editable again.
    latecomer.transact(note('editable again'));
    await vi.waitFor(
      async () => {
        expect(noteWith((await readStoredBoard(boardId)).notes, 'editable again')).toBeDefined();
      },
      { timeout: 10_000 },
    );

    latecomer.disconnect();
  });
});

describe('a change that is not a change (TC-17)', () => {
  it('closes the sender with 1003 and leaves the board and its rows alone', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const troublemaker = await WsClient.connect(boardId);
    const bystander = await WsClient.connect(boardId);
    await troublemaker.waitForSync();
    await bystander.waitForSync();
    await seed(troublemaker, board.updates);
    await vi.waitFor(() => expect(bystander.snapshot().length).toBe(RETRO_NOTES), {
      timeout: 10_000,
    });

    const rowsBefore = (await logRows(boardId)).length;
    const update = (board.updates[1] as Uint8Array).slice();
    bystander.clearReceived();

    // A frame shaped exactly like a sync update, holding bytes that are not one.
    troublemaker.sendRaw(updateFrame(scrambledUpdate(update)));

    const closed = await troublemaker.rawSocket.closed();
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

    // The board is untouched: no row written, nothing quarantined, nobody else disturbed.
    expect(await logRows(boardId)).toHaveLength(rowsBefore);
    expect(await quarantinedCount(boardId)).toBe(0);
    expect(bystander.online).toBe(true);
    expect(bystander.received).toEqual([]);
    expect(comparable(bystander.snapshot())).toEqual(comparable(board.notes));

    // The room goes on serving the people who send it real changes.
    bystander.transact(note('still working'));
    await vi.waitFor(
      async () => {
        expect(noteWith((await readStoredBoard(boardId)).notes, 'still working')).toBeDefined();
      },
      { timeout: 10_000 },
    );

    bystander.disconnect();
  });

  it('closes the sender on a frame that stops arriving halfway through', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();
    await seed(client, board.updates);
    const rowsBefore = (await logRows(boardId)).length;

    client.sendRaw(updateFrame(truncatedUpdate(board.updates[1] as Uint8Array, 8)));
    const closed = await client.rawSocket.closed();
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

    expect(await logRows(boardId)).toHaveLength(rowsBefore);
    expect(await quarantinedCount(boardId)).toBe(0);
  });
});

describe('a room that lost its memory keeps its connections (TC-18)', () => {
  it('reads the board back on the next message and delivers it to the sockets already open', async () => {
    const boardId = newBoardId();
    const author = await WsClient.connect(boardId);
    const other = await WsClient.connect(boardId);
    await author.waitForSync();
    await other.waitForSync();
    author.transact(note('written before the room forgot'));
    await vi.waitFor(() => expect(other.snapshot().length).toBe(1), { timeout: 10_000 });

    const otherSocket = other.rawSocket;

    // The room gives up the board, the way an eviction does, with nobody disconnecting. Both
    // connections are still open: the runtime holds them, not the room.
    await forgetTheBoard(boardId);
    expect(await roomNotes(boardId)).toBeNull();
    expect(author.online).toBe(true);
    expect(other.online).toBe(true);

    // What the room is doing while it reads the board back, read from inside the read.
    const stateDuringLoad: string[] = [];
    await inRoom(boardId, (room, store) => {
      const previous = store.inject;
      store.inject = (point: FaultPoint): void => {
        // What the room calls itself while it is reading the board back.
        if (point === 'load:select-updates') stateDuringLoad.push(room.roomState);
        previous(point);
      };
    });

    other.clearReceived();
    author.transact(note('written after the room forgot'));

    // It arrives on the connection that was already there — the same socket object, never
    // reopened by anybody.
    await vi.waitFor(() => expect(other.snapshot().length).toBe(2), { timeout: 10_000 });
    expect(other.rawSocket).toBe(otherSocket);
    expect(stateDuringLoad).toEqual(['loading']);
    expect(await roomStateOf(boardId)).toBe('ready');

    // And it is written down, from a document the room had to rebuild first.
    const stored = await readStoredBoard(boardId);
    expect(comparable(stored.notes)).toEqual(comparable(other.snapshot()));
    expect(stored.notes.map((note) => note.text).sort()).toEqual([
      'written after the room forgot',
      'written before the room forgot',
    ]);

    author.disconnect();
    other.disconnect();
  });
});

describe('a read that fails in SQL (TC-26)', () => {
  it('closes clients with 4500 and leaves every row where it was', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();
    await seed(client, board.updates);
    const rowsBefore = (await logRows(boardId)).length;

    // One statement fails, on the way to reading the board back.
    await inRoom(boardId, (_room, store) => {
      const previous = store.inject;
      let armed = true;
      store.inject = (point: FaultPoint): void => {
        previous(point);
        if (armed && point === 'load:select-updates') {
          armed = false;
          throw new Error('SQL is having a moment');
        }
      };
    });

    // The room has lost the board and only finds out when the next message asks for it.
    await forgetTheBoard(boardId);
    client.transact(note('a change made against a room that cannot read'));

    const closed = await client.rawSocket.closed();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await roomStateOf(boardId)).toBe('load-failed');

    // Nothing was written, nothing was set aside, nothing was deleted: a bad read is not an
    // excuse to lose anything.
    expect(await logRows(boardId)).toHaveLength(rowsBefore);
    expect(await quarantinedCount(boardId)).toBe(0);
    const stored = await readStoredBoard(boardId);
    expect(comparable(stored.notes)).toEqual(comparable(board.notes));

    // A newcomer inside the retry interval is refused, as it would be for a board that really
    // is gone: the room does not read a board that just failed to be read, once per arrival.
    const tooSoon = await WsClient.connect(boardId);
    expect((await tooSoon.rawSocket.closed()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await roomStateOf(boardId)).toBe('load-failed');

    // Past the interval the same board reads fine: the failure was one statement, once.
    await setLoadRetryInterval(boardId, 200);
    await settle(260);
    const next = await WsClient.connect(boardId);
    await next.waitForSync();
    expect(comparable(next.snapshot())).toEqual(comparable(board.notes));
    expect(await roomStateOf(boardId)).toBe('ready');

    next.disconnect();
  });
});

describe('the room folding its own log', () => {
  it('passes through `compacting` while the log is being folded, and back to ready', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();
    await seed(client, board.updates);

    const states: string[] = [];
    await inRoom(boardId, (room, store) => {
      const previous = store.inject;
      store.inject = (point: FaultPoint): void => {
        // Read from the middle of the transaction that replaces the snapshot.
        if (point === 'compact:after-log-delete') states.push(room.roomState);
        previous(point);
      };
    });

    const flips = await fillTheLog(client);

    expect(flips).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
    expect(states).toContain('compacting');
    expect(await roomStateOf(boardId)).toBe('ready');

    const info = await snapshotInfo(boardId);
    expect(info.chunks).toBeGreaterThan(0);
    expect(info.throughSeq).toBeGreaterThanOrEqual(board.updates.length);
    // What is left to replay is the handful of changes that came after the fold.
    expect((await logRows(boardId)).length).toBeLessThan(COMPACTION_UPDATE_COUNT);

    // The folded board is the board the client is holding.
    const stored = await readStoredBoard(boardId);
    expect(comparable(stored.notes)).toEqual(comparable(client.snapshot()));

    client.disconnect();
  });
});

describe('a board with one damaged change in the log', () => {
  /**
   * What a damaged row costs, and what it does not cost.
   *
   * The cost is that change and what was built on it: rows are the changes as their author sent
   * them, which in Yjs means each one says "you already have the first n of mine", so a row
   * that is missing takes the meaning out of the rows after it. What it does not cost is the
   * board: the room still loads, still serves, still takes changes, and the damage is written
   * down with a reason rather than swallowed. The test after this one is about getting the
   * missing part back.
   */
  it('keeps the board serving and the damage on the record (TC-09)', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();
    await seed(client, board.updates);
    const damaged = (await logRows(boardId))[6];
    if (!damaged) throw new Error('the board did not reach seven log rows');
    const damagedBytes = await scrambleLogRow(boardId, damaged.seq);

    // The room reads the board again, the way a wake from hibernation would.
    await forgetTheBoard(boardId);
    const latecomer = await WsClient.connect(boardId);
    await latecomer.waitForSync();

    expect(await roomStateOf(boardId), 'the board loaded').toBe('ready');
    expect(await quarantinedCount(boardId)).toBe(1);
    const records = await quarantinedRecords(boardId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ seq: damaged.seq, bytes: damagedBytes });
    expect(records[0]?.error, 'the record says why, in the reader\'s words').toMatch(/Error/);

    // A board with a hole in it is still a board: it is served, it is editable, and what
    // people do on it is kept.
    expect(latecomer.online).toBe(true);
    latecomer.transact(note('written on a board that had a damaged row'));
    await vi.waitFor(() => expect(client.snapshot().length).toBe(RETRO_NOTES + 1), {
      timeout: 10_000,
    });
    const stored = await readStoredBoard(boardId);
    expect(stored.result.ok, 'and it was written down').toBe(true);
    expect(
      stored.notes.some((entry) => entry.text === 'written on a board that had a damaged row'),
      'and it is in storage',
    ).toBe(true);

    latecomer.disconnect();
    client.disconnect();
  });

  it('serves what it could read, and takes what a returning client brings (TC-09)', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    const client = await WsClient.connect(boardId);
    await client.waitForSync();
    // One row per change, the way a client sends them: rows that say "you already have the
    // first n of my changes", so a hole in the middle is a hole in what the rest means.
    await seed(client, board.updates);
    const damaged = (await logRows(boardId))[4];
    if (!damaged) throw new Error('the board did not reach five log rows');
    await scrambleLogRow(boardId, damaged.seq);

    // What the surviving rows describe, read the same way the room reads them.
    const surviving = new Y.Doc();
    for (const [index, update] of board.updates.entries()) {
      if (index + 1 === damaged.seq) continue;
      Y.applyUpdate(surviving, update);
    }

    await forgetTheBoard(boardId);
    const reader = await WsClient.connect(boardId);
    await reader.waitForSync();

    expect(await quarantinedCount(boardId)).toBe(1);
    expect(await roomStateOf(boardId)).toBe('ready');
    expect(
      comparable(reader.snapshot()),
      'the room serves the board the log can still account for, and says nothing else',
    ).toEqual(comparable(snapshot(surviving).filter(isStickySnapshot)));

    // The rest of the board is not gone while somebody who saw it is still around. A returning
    // client is asked what the room is missing, and that is the board coming back — and being
    // written down again, so the hole is filled in durable storage, not just in memory.
    client.disconnect();
    await settle(80);
    await client.reconnect();
    await client.waitForSync();
    expect(
      comparable(await roomNotes(boardId) ?? []),
      'the hole is filled in from the client that has it',
    ).toEqual(comparable(board.notes));
    await vi.waitFor(async () => {
      expect(comparable(reader.snapshot())).toEqual(comparable(board.notes));
    }, { timeout: 10_000 });
    const healed = await readStoredBoard(boardId);
    expect(comparable(healed.notes), 'and the repair is in storage now').toEqual(
      comparable(board.notes),
    );
    expect(
      (await logRows(boardId)).length,
      'the missing part came in as a change of its own',
    ).toBeGreaterThan(0);

    client.disconnect();
    reader.disconnect();
  });
});
