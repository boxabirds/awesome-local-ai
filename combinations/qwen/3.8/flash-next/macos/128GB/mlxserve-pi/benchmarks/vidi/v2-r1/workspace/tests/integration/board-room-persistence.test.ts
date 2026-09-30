/// <reference types="@cloudflare/vitest-pool-workers" />
// What the room does with its storage: save before telling, refuse a board it
// cannot read, come back from a board it could not read, and hold nothing in
// memory once nobody is looking.
//
// `tests/integration/board-store.test.ts` is about which rows exist; this file is
// about which frames go out, in which order, and with which close code.
//
// Reaching into the live room: these tests replace the room's own `BoardStore`
// with one built with a fault, and move the room's `loadFailedAt` clock, because
// a disk that fails on demand and an interval that has passed are the two things
// a test cannot otherwise arrange. Both are marked where they happen.
//
// Spec: spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/
// design.md, section persist.room (TC-12 to TC-18, TC-26).
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  BoardStore,
  TEST_CHUNK_BACKUP_KEY,
  type BoardStorage,
  type StorageFaults,
} from '../../src/worker/board-store';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  SyncClient,
  canonicalNotes,
  ensureBoard,
  updateFrame,
  waitFor,
  waitForAsync,
} from './helpers/ws-client';
import type { BoardRoom } from '../../src/worker/board-room';
import worker from '../../src/worker/index';

const stubFor = (boardId: string): DurableObjectStub<BoardRoom> =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as DurableObjectStub<BoardRoom>;

/** The room's own state, read from inside the room. */
const roomState = (boardId: string): Promise<string> =>
  runInDurableObject(stubFor(boardId), (room) => String(room.state));

/** The board as the room holds it in memory, or null when it holds no copy. */
const liveBoard = (boardId: string): Promise<string | null> =>
  runInDurableObject(stubFor(boardId), (room) => {
    const doc = (room as unknown as { doc: Y.Doc | null }).doc;
    return doc === null ? null : canonicalNotes(snapshot(doc));
  });

/** The board as storage holds it, read through a store of the test's own. */
const storedBoard = (boardId: string): Promise<string> =>
  runInDurableObject(stubFor(boardId), (_room, state) => {
    const doc = new Y.Doc();
    const store = new BoardStore(state.storage as unknown as BoardStorage);
    if (!store.load(doc).ok) return 'unreadable';
    return canonicalNotes(snapshot(doc));
  });

interface StoredRows {
  updates: number;
  chunks: number;
  quarantined: number;
  through: string | null;
}

const storedRows = (boardId: string): Promise<StoredRows> =>
  runInDurableObject(stubFor(boardId), (_room, state) => {
    const through = state.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
      .toArray()[0];
    return {
      updates: Number(
        state.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0]!['n'],
      ),
      chunks: Number(
        state.storage.sql
          .exec('SELECT COUNT(*) AS n FROM snapshot_chunks')
          .toArray()[0]!['n'],
      ),
      quarantined: Number(
        state.storage.sql
          .exec('SELECT COUNT(*) AS n FROM quarantined_updates')
          .toArray()[0]!['n'],
      ),
      through: through === undefined ? null : String(through['value']),
    };
  });

/** Put a store with a fault in front of the room's own. The room builds its
 * store without faults — production has no way to ask for one — so a test that
 * wants a failing statement installs one here. */
const giveRoomAFaultyStore = (
  boardId: string,
  faults: (statement: string) => boolean,
): Promise<void> =>
  runInDurableObject(stubFor(boardId), (room, state) => {
    const failing: StorageFaults = {
      beforeStatement(statement: string): void {
        if (faults(statement)) throw new Error('the disk is full');
      },
    };
    (room as unknown as { store: BoardStore }).store = new BoardStore(
      state.storage as unknown as BoardStorage,
      failing,
    );
  });

/** The room's own `testHook`, called the way the story 4 HTTP route calls it. */
const roomHook = (
  boardId: string,
  kind: 'compact' | 'corrupt-snapshot' | 'repair-snapshot',
): Promise<{ ok: boolean; reason?: string }> =>
  runInDurableObject(stubFor(boardId), (room) => room.testHook(kind));

/** Put a silently damaged snapshot back, without reloading the room. */
const repairSnapshotSilently = (boardId: string): Promise<void> =>
  runInDurableObject(stubFor(boardId), (_room, state) => {
    const backup = state.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', TEST_CHUNK_BACKUP_KEY)
      .toArray()[0]!['value'];
    const bytes = new Uint8Array(String(backup).length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = parseInt(String(backup).slice(index * 2, index * 2 + 2), 16);
    }
    state.storage.sql.exec(
      'INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (0, ?)',
      bytes.buffer,
    );
    state.storage.sql.exec('DELETE FROM storage_meta WHERE key = ?', TEST_CHUNK_BACKUP_KEY);
  });

/** Move the room's retry clock past LOAD_RETRY_MIN_INTERVAL_MS rather than
 * sitting out five seconds of a test: the interval itself is what TC-27 checks,
 * and what is checked here is that the room acts on it. */
const letTheRetryIntervalPass = (boardId: string): Promise<void> =>
  runInDurableObject(stubFor(boardId), (room) => {
    (room as unknown as { loadFailedAt: number }).loadFailedAt =
      Date.now() - LOAD_RETRY_MIN_INTERVAL_MS - 1;
  });

/** Connect two people to a board and wait until both can see the board. */
const connectPair = async (
  boardId: string,
): Promise<{ a: SyncClient; b: SyncClient }> => {
  const a = await SyncClient.connect(boardId);
  await a.waitForSync();
  const b = await SyncClient.connect(boardId);
  await b.waitForSync();
  return { a, b };
};

const notesOf = (client: SyncClient): readonly StickySnapshot[] => client.notes;

describe('a board that comes back (persist.room)', () => {
  // TC-12: the order a change takes, and the reason it takes it in that order.
  it('stores a note before the other person is told about it (TC-12)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);

    const noteId = a.addNote({ x: 20, y: 8 });
    await waitFor(() => notesOf(b).some((note) => note.id === noteId), 'B to see the note');

    // By the time B was told, the row was already there: the room stores what it
    // applied and only then broadcasts, so nothing anyone is shown is a change
    // the board does not have.
    const rows = await storedRows(boardId);
    expect(rows.updates).toBeGreaterThanOrEqual(1);
    const stored = await storedBoard(boardId);
    expect(stored).toContain(noteId);
    expect(canonicalNotes(notesOf(b))).toBe(stored);

    a.close();
    b.close();
  });

  // TC-13: the board is in storage, not in the room. Everybody leaves, the room
  // keeps nothing, and the next person to arrive gets the board anyway — which
  // is the same thing that happens when the process is evicted and a new room
  // object is built over the same storage.
  it('gives the board to the next person after everybody left (TC-13)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    for (let index = 0; index < 25; index += 1) {
      const id = a.addNote({ x: index * 15, y: index * 9 });
      if (index % 3 === 0) a.type(id, `note ${index}`);
    }
    await waitFor(() => notesOf(b).length === 25, 'B to see all 25 notes');
    const expected = canonicalNotes(notesOf(a));

    a.close();
    b.close();
    // Idle means idle: no connection, and no document held against it.
    await waitForAsync(async () => (await liveBoard(boardId)) === null, 'the room to hold nothing');
    expect(await roomState(boardId)).toBe('ready');
    // And what it left behind is the board.
    expect(await storedBoard(boardId)).toBe(expected);

    const c = await SyncClient.connect(boardId);
    await c.waitForSync();
    expect(canonicalNotes(c.notes)).toBe(expected);

    c.close();
  });

  // TC-14: a change the board could not save is a change nobody is shown. The
  // room closes every connection with the code that says the board could not be
  // saved, keeps nothing it could not save, and the change comes back from the
  // person who made it.
  it('closes every connection when a change cannot be stored, and takes it back when they return (TC-14)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const rowsBefore = await storedRows(boardId);

    let failWrites = true;
    await giveRoomAFaultyStore(boardId, (statement) => failWrites && statement.startsWith('INSERT INTO updates'));

    const noteId = a.addNote({ x: 5, y: 5 });
    a.type(noteId, 'the change that could not be saved');

    // Both of them learn, and neither of them is left believing the change is in
    // the board.
    expect(await a.waitForClose()).toBe(1011);
    expect(await b.waitForClose()).toBe(1011);
    expect(notesOf(b).some((note) => note.id === noteId)).toBe(false);

    // The room kept nothing it could not save, and stored nothing extra.
    expect(await liveBoard(boardId)).toBeNull();
    const rowsAfter = await storedRows(boardId);
    expect(rowsAfter.updates).toBe(rowsBefore.updates);
    expect(rowsAfter.quarantined).toBe(0);

    // The person who made the change still has it. They come back, and the board
    // takes it from them the way it takes anything a newcomer holds.
    a.hangUpWithoutSayingGoodbye();
    b.hangUpWithoutSayingGoodbye();
    failWrites = false;

    const aBack = await SyncClient.connectWith(boardId, a.doc);
    await aBack.waitForSync();
    expect(await storedBoard(boardId)).toContain(noteId);

    const bBack = await SyncClient.connect(boardId);
    await bBack.waitForSync();
    expect(canonicalNotes(bBack.notes)).toBe(canonicalNotes(aBack.notes));
    expect(aBack.textOf(noteId)).toBe('the change that could not be saved');

    aBack.close();
    bBack.close();
  });

  // TC-15: a board whose snapshot cannot be read is refused, not served empty.
  it('refuses a connection to a board it cannot read, and stores nothing from it (TC-15)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    for (let index = 0; index < 25; index += 1) {
      a.addNote({ x: index * 15, y: index * 9 });
    }
    await waitFor(() => notesOf(b).length === 25, 'B to see all 25 notes');
    expect(await roomHook(boardId, 'compact')).toEqual({ ok: true });
    const rowsBefore = await storedRows(boardId);
    expect(rowsBefore.chunks).toBeGreaterThanOrEqual(1);

    expect((await roomHook(boardId, 'corrupt-snapshot')).ok).toBe(true);
    expect(await roomState(boardId)).toBe('load-failed');

    // Whoever arrives now is turned away with the reason, and the room does not
    // answer them with the empty board it does not have.
    const c = await SyncClient.connect(boardId);
    expect(await c.waitForClose()).toBe(4500);
    expect(c.frames.length).toBe(0);
    expect(c.notes.length).toBe(0);

    // And what they sent is not in the board: a room that cannot read its board
    // does not write to it either.
    const rowsAfter = await storedRows(boardId);
    expect(rowsAfter.updates).toBe(rowsBefore.updates);
    expect(rowsAfter.chunks).toBe(rowsBefore.chunks);
    expect(rowsAfter.quarantined).toBe(0);

    a.close();
    b.close();
  });

  // TC-16: the retry interval, both sides of it. A room that failed to read its
  // board tries again for somebody who arrives at most once per
  // LOAD_RETRY_MIN_INTERVAL_MS, and when the board can be read again the very
  // next attempt serves it — nobody presses reload.
  it('tries to read a failed board again on the interval, and serves it once it can (TC-16)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    for (let index = 0; index < 25; index += 1) {
      a.addNote({ x: index * 15, y: index * 9 });
    }
    await waitFor(() => notesOf(b).length === 25, 'B to see all 25 notes');
    expect(await roomHook(boardId, 'compact')).toEqual({ ok: true });
    const expected = canonicalNotes(notesOf(a));
    a.close();
    b.close();

    expect((await roomHook(boardId, 'corrupt-snapshot')).ok).toBe(true);
    const failedAt = await runInDurableObject(stubFor(boardId), (room) =>
      Date.now() - (room as unknown as { loadFailedAt: number }).loadFailedAt,
    );
    expect(failedAt).toBeLessThan(LOAD_RETRY_MIN_INTERVAL_MS);

    // Inside the interval: refused, and the load was not even attempted — the
    // time it failed is still the moment it failed, unchanged.
    const early = await SyncClient.connect(boardId);
    expect(await early.waitForClose()).toBe(4500);
    expect(
      await runInDurableObject(stubFor(boardId), (room) =>
        Date.now() - (room as unknown as { loadFailedAt: number }).loadFailedAt,
      ),
    ).toBeLessThan(LOAD_RETRY_MIN_INTERVAL_MS);
    expect(await roomState(boardId)).toBe('load-failed');

    // The board is repaired while nobody is looking at it.
    await repairSnapshotSilently(boardId);
    expect(await roomState(boardId)).toBe('load-failed');

    // The interval passes, somebody arrives, and the board is read and served.
    await letTheRetryIntervalPass(boardId);
    const c = await SyncClient.connect(boardId);
    await c.waitForSync();
    expect(canonicalNotes(c.notes)).toBe(expected);
    expect(await roomState(boardId)).toBe('ready');

    c.close();
  });

  // TC-17: garbage that arrives is refused with story 3's code, and it leaves no
  // trace in storage. Story 3 could only assert the room's document was
  // unchanged; storage is the thing that has to stay unchanged.
  it('stores nothing when a sender sends bytes that are not an update (TC-17)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const noteId = a.addNote({ x: 1, y: 1 });
    await waitFor(() => notesOf(b).length === 1, 'B to see the note');
    const rowsBefore = await storedRows(boardId);

    a.sendRaw(updateFrame(new Uint8Array([1, 2, 3, 9, 9, 9])));
    expect(await a.waitForClose()).toBe(1003);

    // Not applied, so not stored: the room only writes what it read to the end.
    expect((await storedRows(boardId)).updates).toBe(rowsBefore.updates);
    expect(await storedBoard(boardId)).toContain(noteId);

    // Nobody else is disturbed, and the room still relays.
    expect(b.closeCode).toBeNull();
    const secondId = a.addNote({ x: 2, y: 2 });
    await waitFor(() => notesOf(b).some((note) => note.id === secondId), 'B to see the next note');

    a.close();
    b.close();
  });

  // TC-18: the hibernation path. A connection the runtime accepted before the
  // room let its document go still gets what the room reads back afterwards:
  // the broadcast goes to the runtime's list of connections, not to a list the
  // room remembers.
  it('broadcasts to a connection it accepted before it let its document go (TC-18)', async () => {
    const boardId = newBoardId();
    const first = await SyncClient.connect(boardId);
    await first.waitForSync();
    for (let index = 0; index < 25; index += 1) {
      first.addNote({ x: index * 15, y: index * 9 });
    }
    await waitFor(() => notesOf(first).length === 25, 'the first person to see 25 notes');
    const expected = canonicalNotes(notesOf(first));

    // Everybody leaves: the room gives its document back and holds nothing.
    first.close();
    await waitForAsync(async () => (await liveBoard(boardId)) === null, 'the room to hold nothing');

    // Two people arrive; the room reads the board back out of storage, and one of
    // them has been here before.
    const back = await SyncClient.connect(boardId);
    await back.waitForSync();
    expect(canonicalNotes(back.notes)).toBe(expected);
    const other = await SyncClient.connect(boardId);
    await other.waitForSync();

    // The change goes to a connection that was accepted in an earlier wake of
    // this object than the one that made the change.
    const noteId = back.addNote({ x: 400, y: 400 });
    await waitFor(() => notesOf(other).some((note) => note.id === noteId), 'the other person to see it');
    expect(await liveBoard(boardId)).toBe(canonicalNotes(notesOf(other)));

    back.close();
    other.close();
  });

  // TC-26: a board whose storage cannot be *read* is in the same state as a
  // board whose storage cannot be understood: refused with the reason, never
  // answered with an empty board, and working again for the next person once
  // storage is.
  it('refuses everybody while its storage cannot be read, and serves them once it can (TC-26)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    for (let index = 0; index < 25; index += 1) {
      a.addNote({ x: index * 15, y: index * 9 });
    }
    await waitFor(() => notesOf(b).length === 25, 'B to see all 25 notes');
    const expected = canonicalNotes(notesOf(a));
    a.close();
    b.close();
    await waitForAsync(
      async () => (await liveBoard(boardId)) === null,
      'the room to hold nothing',
    );

    // Reads fail from here on. The room has let its document go, so the next
    // connection has to read the board and finds this.
    let failReads = true;
    await giveRoomAFaultyStore(boardId, (statement) => failReads && statement.startsWith('SELECT'));

    const refused = await SyncClient.connect(boardId);
    expect(await refused.waitForClose()).toBe(4500);
    expect(await roomState(boardId)).toBe('load-failed');

    // Storage is fine again; the next attempt reads the board and serves it.
    failReads = false;
    await letTheRetryIntervalPass(boardId);
    const c = await SyncClient.connect(boardId);
    await c.waitForSync();
    expect(canonicalNotes(c.notes)).toBe(expected);
    expect(await roomState(boardId)).toBe('ready');

    c.close();
  });

  // What TC-13 and TC-18 together are meant to keep: an idle board's memory is
  // its storage, and the room does not quietly keep a copy "just in case".
  it('holds no document while nobody is connected', async () => {
    const boardId = newBoardId();
    const a = await SyncClient.connect(boardId);
    await a.waitForSync();
    expect(await liveBoard(boardId)).toBe(canonicalNotes(a.notes));

    a.close();
    await waitForAsync(async () => (await liveBoard(boardId)) === null, 'the document to be let go');
    expect(await roomState(boardId)).toBe('ready');
  });
});

describe('the test-hook route (TC-24 ask)', () => {
  // The damage and the repair the e2e scenario uses are real writes to a real
  // board, so the route that triggers them must not exist in a Worker that
  // nobody asked to be damaged. `TC-24` says the route is absent without the
  // flag, and "absent" here means the Worker never answers it as a hook: the
  // request goes on to the assets, which is where an unknown path belongs.
  const hookFetch = (boardId: string, method = 'POST'): Promise<Response> =>
    worker.fetch(
      new Request(`https://vidi6.test/api/rooms/${boardId}?__test=compact`, { method }),
      // The flag is the only thing in this environment that differs from the
      // deployed one, which is the point of the test.
      { BOARD_ROOM: env.BOARD_ROOM, ASSETS: env.ASSETS, TEST_HOOKS: '1' },
    );

  it('is not a hook when the flag is not set', async () => {
    // `SELF` is the Worker as configured, and nothing in the committed
    // configuration sets the flag. The request is then an ordinary request for a
    // live connection that did not say `Upgrade: websocket`, which is what the
    // room route says to that: 426, no hook having run.
    const response = await SELF.fetch(
      `https://vidi6.test/api/rooms/${newBoardId()}?__test=compact`,
      { method: 'POST' },
    );
    expect(response.status).toBe(426);
    expect(await response.json()).toEqual({
      error: { code: 'websocket_upgrade_required', message: 'Connect to this room with `Upgrade: websocket`.' },
    });
  });

  it('is a hook when the flag is set', async () => {
    // Story 5: the hook reaches into a board that exists; a fresh id is created
    // first so there is a board to compact (share.not_found left nothing to
    // compact on a board nobody made).
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const response = await hookFetch(boardId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('refuses a board id that is not a board id, and only answers POST', async () => {
    // A readable-looking string of the right shape, and one that is the wrong
    // shape, are both refused: the hook can only ever be pointed at a board.
    expect((await hookFetch('lki3d0m1mzfw6ty66d9aux2ge')).status).toBe(400);
    expect((await hookFetch('not a board id')).status).toBe(400);
    // A traversal never arrives as a path at all — the URL parser folds it away
    // before the route is consulted — so what matters is only that no board is
    // reached, which the 400 above and this 405 (the assets, again) both say.
    expect((await hookFetch('../../etc/passwd')).status).not.toBe(200);
    expect((await hookFetch(newBoardId(), 'GET')).status).toBe(405);
  });
});
