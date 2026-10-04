/**
 * The persistent room (story 4, task 5): TC-12 to TC-18, TC-26.
 *
 * These run in workerd against the real Durable Object, real SQLite and real
 * WebSockets. What they hold the room to is not "the board is in memory and
 * somebody saw it" but the two promises a person can actually notice:
 *
 *  - a change nobody has been shown yet is already in storage (TC-12, TC-20's
 *    guarantee at the level below the browser);
 *  - when storage says no, the room says so, and shows nobody a board that is not
 *    there (TC-14, TC-15, TC-16, TC-26).
 *
 * Failure states are reached by breaking storage or a store method from the outside
 * — through the room's own object, or through the test hooks the gated route uses —
 * so no production code carries a seam "for testing".
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { createSticky, getStickyText } from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import type { TestHookName } from '../../src/worker/test-hooks';
import { boardKey } from '../fixtures/boards';
import {
  connectAll,
  corruptUpdateFrame,
  freshBoardId,
  RoomClient,
} from './ws-client';

const HOOK_BASE = 'http://whiteboard.local/__test/boards/';

function stub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Call a test hook on the board's own object, as the gated route would. */
async function hook(
  boardId: string,
  name: TestHookName,
  body?: Uint8Array,
): Promise<Record<string, unknown>> {
  return runInDurableObject(stub(boardId), async (room) => {
    const response = await room.runTestHook(
      name,
      new Request(`${HOOK_BASE}${boardId}/${name}`, { method: 'POST', body: body as BodyInit }),
    );
    return (await response.json()) as Record<string, unknown>;
  });
}

/** What the board's tables hold, read by a document that has never seen the edits. */
async function stored(boardId: string): Promise<{ key: string; notes: number; updates: number }> {
  return runInDurableObject(stub(boardId), (room) => {
    const doc = new Y.Doc();
    const result = room.store.load(doc);
    const notes = doc.getMap('objects').size;
    const out = { key: boardKey(doc), notes, updates: room.store.stats().updates };
    doc.destroy();
    if (!result.ok) throw new Error(`stored board did not load: ${result.reason}`);
    return out;
  });
}

/** Count how often the room reads storage, by wrapping the store's own method. */
async function countLoads(boardId: string): Promise<() => Promise<number>> {
  await runInDurableObject(stub(boardId), (room) => {
    const store = room.store;
    const original = store.load.bind(store);
    (room as unknown as { loadCalls: number }).loadCalls = 0;
    store.load = (doc: Y.Doc) => {
      (room as unknown as { loadCalls: number }).loadCalls += 1;
      return original(doc);
    };
  });
  return async () =>
    runInDurableObject(stub(boardId), (room) => {
      return (room as unknown as { loadCalls: number }).loadCalls ?? -1;
    });
}

/**
 * Wait until the rows hold `notes` notes.
 *
 * Waiting on the writing client's own document would race the socket: a frame still
 * in flight when that page closes is lost, and the test would then be asserting
 * about a board that was never written.
 */
/**
 * Wait until storage holds exactly what this client holds.
 *
 * Counting stored notes is not enough, and this bit the first version of these
 * tests: writing a note and typing into it are two changes, and the note on its own
 * already makes the count — so a test that waits for a number can stop while the
 * board it is checking has a note and none of its words.
 */
async function waitForStoredLike(boardId: string, doc: Y.Doc): Promise<void> {
  const wanted = boardKey(doc);
  const deadline = Date.now() + 5000;
  for (;;) {
    const now = await stored(boardId);
    if (now.key === wanted) return;
    if (Date.now() > deadline) {
      throw new Error(`storage holds ${now.key} after 5s, wanted ${wanted}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Write a note as a client would, and wait for the room to have taken it. */
async function addNote(client: RoomClient, x: number, y: number, text: string): Promise<string> {
  const id = createSticky(client.doc, { x, y });
  getStickyText(client.doc, id)?.insert(0, text);
  return id;
}

describe('a change is stored before it is shown (TC-12)', () => {
  it('is in the update log by the time anybody else sees it', async () => {
    const board = freshBoardId();
    const [a, b] = await connectAll(board, 2);

    await addNote(a, 40, 60, 'written once, kept twice');
    await b.seesNoteCount(1);

    // By the time the note reaches B's screen the row is already there: the room
    // writes before it relays, so seeing it means it was kept.
    const storedBoard = await stored(board);
    expect(storedBoard.updates, 'one row per change, plus whatever the sync stored').toBeGreaterThan(
      0,
    );
    expect(storedBoard.notes).toBe(1);
    expect(storedBoard.key, 'what storage holds is what B is looking at').toBe(boardKey(b.doc));

    a.destroy();
    b.destroy();
  });
});

describe('everybody leaves and the board is still there (TC-13)', () => {
  it('serves a new client out of storage after the room forgot the board', async () => {
    const board = freshBoardId();
    const a = await RoomClient.connect(board);
    await addNote(a, 0, 0, 'first');
    await addNote(a, 30, 30, 'second');
    const left = boardKey(a.doc);
    await waitForStoredLike(board, a.doc);
    await a.destroy();

    // What the runtime does between stories: the object is gone, its memory with
    // it. `reload` discards the in-memory board, which is all an evicted room has.
    await runInDurableObject(stub(board), (room) => room.reload());

    const c = await RoomClient.connect(board);
    await c.seesNoteCount(2);
    expect(boardKey(c.doc)).toBe(left);
    expect(c.notes.map((n) => n.text).sort()).toEqual(['first', 'second']);
    c.destroy();
  });
});

describe('a change that could not be saved reaches nobody (TC-14)', () => {
  it('closes every socket with 1011 and takes the change again on reconnect', async () => {
    const board = freshBoardId();
    const [a, b] = await connectAll(board, 2);
    await addNote(a, 10, 10, 'saved first');
    await b.seesNoteCount(1);

    // One failed write, injected where the room does its storing.
    await runInDurableObject(stub(board), (room) => {
      const store = room.store;
      const original = store.append.bind(store);
      let armed = true;
      store.append = (update: Uint8Array) => {
        if (armed) {
          armed = false;
          throw new Error('injected: the write did not happen');
        }
        return original(update);
      };
    });

    await addNote(a, 20, 20, 'never saved');
    const [closedA, closedB] = [await a.waitForClose(), await b.waitForClose()];
    expect(closedA.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(closedB.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.notes.map((n) => n.text), 'B was never shown the unsaved change').toEqual([
      'saved first',
    ]);

    // Both pages still hold their own copies (that is what a page is). A comes back
    // holding the change the service refused; the room takes it on the second try.
    const carried = Y.encodeStateAsUpdate(a.doc);
    const a2 = await RoomClient.connect(board, { seed: carried });
    const b2 = await RoomClient.connect(board);
    await b2.seesNoteCount(2);
    expect(b2.notes.map((n) => n.text).sort()).toEqual(['never saved', 'saved first']);
    expect((await stored(board)).notes).toBe(2);

    a2.destroy();
    b2.destroy();
  });
});

describe('a board that cannot be read is reported, not emptied (TC-15, TC-16)', () => {
  /** A board with content and a snapshot, then a chunk replaced by other bytes. */
  async function brokenBoard(): Promise<string> {
    const board = freshBoardId();
    const a = await RoomClient.connect(board);
    await addNote(a, 0, 0, 'one');
    await addNote(a, 40, 40, 'two');
    await waitForStoredLike(board, a.doc);
    await a.destroy();

    expect(await hook(board, 'compact')).toMatchObject({ ok: true, chunks: 1 });
    expect(await hook(board, 'corrupt-snapshot')).toMatchObject({ ok: true, corruptedChunk: 0 });
    return board;
  }

  it('closes a joining client with 4500 and stores nothing it sends (TC-15)', async () => {
    const board = await brokenBoard();
    const rowsBefore = (await runInDurableObject(stub(board), (room) => room.store.stats()))
      .updates;

    // A returning editor, holding a change of its own: exactly what a page does on
    // reconnect — offer its state, hope for a SyncStep2.
    const mine = new Y.Doc();
    createSticky(mine, { x: 500, y: 500 });
    const client = await RoomClient.connect(board, {
      silent: true,
      seed: Y.encodeStateAsUpdate(mine),
    });
    mine.destroy();
    client.sendSyncStep1();

    const closed = await client.waitForClose();
    expect(closed.code, 'a code y-websocket retries instead of giving up').toBe(
      CLOSE_BOARD_LOAD_FAILED,
    );
    const after = await runInDurableObject(stub(board), (room) => room.store.stats());
    expect(after.updates, 'nothing was written to a board that could not be read').toBe(rowsBefore);
    expect(after.chunks, 'the damaged snapshot was not quietly replaced').toBe(1);
  });

  it('waits out the retry interval, then loads again after a repair (TC-16)', async () => {
    const board = await brokenBoard();
    const loads = await countLoads(board);

    const first = await RoomClient.connect(board, { silent: true });
    expect((await first.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Inside the retry interval the room does not read storage again: a page that
    // reconnects every second cannot turn a failing board into a load storm.
    const inside = await RoomClient.connect(board, { silent: true });
    expect((await inside.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await loads(), 'both refusals happened without reading storage').toBe(0);

    // Storage is whole again. The repair hook ends the retry interval, which is
    // what the passage of LOAD_RETRY_MIN_INTERVAL_MS would have done anyway.
    expect(await hook(board, 'repair')).toMatchObject({ ok: true });
    const back = await RoomClient.connect(board);
    await back.seesNoteCount(2);
    expect(back.notes.map((n) => n.text).sort()).toEqual(['one', 'two']);
    expect(await loads(), 'the board was read again, successfully').toBe(1);
    back.destroy();
  });
});

describe('an update the room cannot use costs one socket (TC-17)', () => {
  it('closes the sender with 1003 and leaves the log alone', async () => {
    const board = freshBoardId();
    const [a, b] = await connectAll(board, 2);
    await addNote(a, 0, 0, 'kept');
    await b.seesNoteCount(1);
    const rowsBefore = (await stored(board)).updates;

    b.sendBytes(corruptUpdateFrame(new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7])));

    expect((await b.waitForClose()).code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect((await stored(board)).updates, 'nothing was stored from the broken frame').toBe(rowsBefore);

    // The other editor carries on: one bad peer is not an outage.
    await addNote(a, 20, 20, 'still working');
    const c = await RoomClient.connect(board);
    await c.seesNoteCount(2);
    a.destroy();
    c.destroy();
  });
});

describe('a woken room keeps the connections it inherited (TC-18)', () => {
  it('delivers to sockets accepted before it reloaded the board', async () => {
    const board = freshBoardId();
    const [a, b] = await connectAll(board, 2);
    await addNote(a, 0, 0, 'before');
    await b.seesNoteCount(1);

    // The room loses its document and reads the board from storage again, while
    // both sockets stay open: the runtime's socket list, not the room's own, is
    // what a relay walks.
    await runInDurableObject(stub(board), (room) => room.reload());

    await addNote(a, 30, 30, 'after');
    await b.seesNoteCount(2);
    expect(b.notes.map((n) => n.text).sort()).toEqual(['after', 'before']);

    // And the reloaded room is still saving: the change after the wake is on disk.
    expect((await stored(board)).notes).toBe(2);
    a.destroy();
    b.destroy();
  });
});

describe('a load that fails in SQL (TC-26)', () => {
  it('closes joining clients with 4500 rather than serving an empty board', async () => {
    const board = freshBoardId();
    const a = await RoomClient.connect(board);
    await addNote(a, 0, 0, 'unreadable in one column');
    await waitForStoredLike(board, a.doc);
    await a.destroy();

    // Break what the read asks for, in a shape `migrate` does not repair: the
    // column the update log is selected by is gone.
    await runInDurableObject(stub(board), (_room, state) => {
      state.storage.sql.exec('ALTER TABLE updates RENAME COLUMN data TO data_unreadable');
    });

    const client = await RoomClient.connect(board, { silent: true });
    expect((await client.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Put the column back: the board is where it always was.
    await runInDurableObject(stub(board), (_room, state) => {
      state.storage.sql.exec('ALTER TABLE updates RENAME COLUMN data_unreadable TO data');
    });
    await runInDurableObject(stub(board), (room) => room.reload());

    const back = await RoomClient.connect(board);
    expect(back.notes.map((n) => n.text)).toEqual(['unreadable in one column']);
    back.destroy();
  });
});
