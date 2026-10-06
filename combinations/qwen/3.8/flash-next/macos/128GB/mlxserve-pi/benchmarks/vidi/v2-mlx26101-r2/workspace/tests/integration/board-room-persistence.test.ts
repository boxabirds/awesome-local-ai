/**
 * The persistent room: durability, hibernation and the two failures a board can have
 * (TC-12 to TC-18, TC-26).
 *
 * These run in workerd against the real Worker, real WebSocket pairs and the board's
 * real SQLite database. Where a test needs the room to be in a state it would take an
 * hour to reach by editing - the object evicted, the board folded into a snapshot, a
 * write that failed - it says so in the test and puts the room there through the
 * room's own door (`hibernateNow`, `/__test/boards/:id/*`, a shadowed method on the
 * room's own store). Nothing here pretends to be storage: the assertions are read back
 * out of the rows, with a store that is not the room's.
 *
 * The order the room works in - applied, written, broadcast - is what most of these
 * are about, because it is the property the story rests on: nobody ever sees a change
 * that is not in storage.
 */

import { SELF, env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id.js';
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.js';
import { LOAD_RETRY_MIN_INTERVAL_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config.js';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol.js';
import { BoardStore, type SqlValue } from '../../src/worker/board-store.js';
import type { BoardRoom } from '../../src/worker/board-room.js';
import type { RoomDebugState } from '../../src/worker/room-state.js';
import { sameBoard } from '../fixtures/boards.js';
import {
  brokenUpdateFrame,
  connectClient,
  eventually,
  requestRoom,
  syncedClient,
  syncStep1Frame,
  type Client,
} from './ws-client.js';

/* ---------------------------------------------------------------------------- helpers */

/** The room's own storage. `ctx` is protected on the class and a test is not a
 * subclass, but reading the real rows is the point of these tests. */
const storageOf = (room: BoardRoom): DurableObjectStorage =>
  (room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage;

/** Run something inside a board's object, over its real storage. */
const inBoard = <T>(boardId: string, fn: (room: BoardRoom, storage: DurableObjectStorage) => T) =>
  runInDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)), (room) =>
    fn(room, storageOf(room)),
  );

const countRows = (storage: DurableObjectStorage, table: string): number =>
  storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0]!.n;

/** What the room says it is. */
const debugOf = (boardId: string): Promise<RoomDebugState> =>
  inBoard(boardId, (room) => room.debugState());

/** The board as the rows hold it, plus what the rows are. */
interface StoredBoard {
  notes: readonly StickySnapshot[];
  load: ReturnType<BoardStore['load']>;
  rows: number;
  bytes: number;
  chunks: number;
  quarantined: number;
}

/**
 * The board as storage holds it, read by a store that has never seen the room - which
 * is what an object thrown out and woken from these rows would read. Nothing here
 * comes from the room's memory, which is the whole reason it exists: a test that asked
 * the room for its board would only prove that the room still has it.
 */
const boardFromStorage = (boardId: string): Promise<StoredBoard> =>
  inBoard(boardId, (_room, storage) => {
    const store = new BoardStore(storage);
    store.migrate();
    const doc = new Y.Doc();
    const load = store.load(doc);
    return {
      notes: snapshot(doc),
      load,
      rows: countRows(storage, 'updates'),
      bytes: storage.sql
        .exec<{ bytes: number }>(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM updates`)
        .toArray()[0]!.bytes,
      chunks: countRows(storage, 'snapshot_chunks'),
      quarantined: countRows(storage, 'quarantined_updates'),
    };
  });

/** One note, created the way the client creates one. */
function drawNote(client: Client, text: string, at = { x: 100, y: 100 }): string {
  const id = createSticky(client.doc, at);
  if (id === false) throw new Error('the client could not create a note');
  getStickyText(client.doc, id)?.insert(0, text);
  return id;
}

const textsOf = (notes: readonly StickySnapshot[]): string[] => notes.map((note) => note.text);

/**
 * The room's store, seen from outside the class. `append` and `rows` are its own
 * methods; putting a function of our own on the instance shadows them for this
 * instance only, and deleting it again gives the real one back. This is how a test
 * makes a write or a read fail without pretending to be storage: the statement that
 * fails is the statement the store would have run.
 */
type ShadowableStore = {
  append?: (update: Uint8Array) => void;
  rows?: (sql: string, ...bindings: SqlValue[]) => unknown[];
};
const storeOf = (room: BoardRoom): ShadowableStore =>
  (room as unknown as { store: ShadowableStore }).store;

/**
 * The store's own `rows`, taken from the prototype. The shadow below delegates to this
 * one rather than to whatever `store.rows` happens to be, so putting the shadow on twice
 * cannot make it call itself.
 */
const realRows = (store: object): ((sql: string, ...bindings: SqlValue[]) => unknown[]) =>
  (Object.getPrototypeOf(store) as unknown as {
    rows: (sql: string, ...bindings: SqlValue[]) => unknown[];
  }).rows;

/** Make the next write to this board's log throw, and every one after it. */
const breakStorage = (boardId: string): Promise<unknown> =>
  inBoard(boardId, (room) => {
    storeOf(room).append = (): never => {
      throw new Error('injected: the write did not happen');
    };
    return true;
  });

/** Give this board's store its real `append` back. */
const repairStorage = (boardId: string): Promise<unknown> =>
  inBoard(boardId, (room) => {
    delete storeOf(room).append;
    return true;
  });

/**
 * Make the read of the log - the SELECT that walks the board's changes during a load -
 * throw, and leave everything else alone. The statement is matched by its prefix, so
 * this fails the read a load depends on and nothing else.
 */
const breakLogRead = (boardId: string): Promise<unknown> =>
  inBoard(boardId, (room) => {
    const store = storeOf(room);
    const real = realRows(store as object);
    store.rows = (sql: string, ...bindings: SqlValue[]): unknown[] => {
      if (sql.startsWith('SELECT seq, data, bytes FROM updates')) {
        throw new Error('injected: the read did not happen');
      }
      return real.call(store, sql, ...bindings);
    };
    return true;
  });

/** Give this board's store its real `rows` back. */
const repairLogRead = (boardId: string): Promise<unknown> =>
  inBoard(boardId, (room) => {
    delete storeOf(room).rows;
    return true;
  });

/** POST one of the test routes and read its answer. */
async function hook(
  boardId: string,
  action: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  // `SELF`, not the global `fetch`: this request has to go to the Worker under test.
  const response = await SELF.fetch(`http://localhost/__test/boards/${boardId}/${action}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON: the status is the answer, and the body goes with the failure.
    json = { body: text };
  }
  return { status: response.status, json };
}

/**
 * Wait until the notes are in the rows - not merely made. Most of the tests below go on
 * to damage, fold or read storage, and a change still on its way over the socket would
 * be measured as a board that had lost something.
 */
async function settle(boardId: string, texts: string[]): Promise<void> {
  await eventually(
    async () => expect(textsOf((await boardFromStorage(boardId)).notes)).toEqual(texts),
    { what: `the rows to hold ${texts.length} note(s)` },
  );
}

/** A board nobody else is using, so its rows belong to this test alone. */
let board: string;
beforeEach(() => {
  board = newBoardId();
});

/* ------------------------------------------------------------------- TC-12: the order */

describe('a board that is written before it is shown (TC-12)', () => {
  it('has the change in storage by the time anyone else sees it', async () => {
    const a = await syncedClient(board);
    const b = await syncedClient(board);

    drawNote(a, 'written before it is shown');
    // B sees the note.
    await eventually(() => expect(b.snapshot()).toHaveLength(1), { what: 'B to see the note' });

    // ...and at that same moment the row is already there. The room writes first and
    // tells people afterwards, so for anybody on the board "I can see it" and "it is
    // saved" are the same fact.
    const stored = await boardFromStorage(board);
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    expect(sameBoard(stored.notes, b.snapshot())).toBe(true);
    // Two rows for the note - its creation and its text - and one for the connection
    // that brought it: a client's own setup of the board is a change like any other and
    // is stored like one. Not two each for the note itself: a change is written once.
    expect(stored.rows).toBe(4);

    // A change of B's own is two more rows and no more.
    drawNote(b, 'the second note', { x: 400, y: 200 });
    await eventually(() => expect(a.snapshot()).toHaveLength(2), {
      what: 'A to see the second note',
    });
    const after = await boardFromStorage(board);
    expect(after.rows).toBe(6);
    expect(textsOf(after.notes)).toEqual(['written before it is shown', 'the second note']);

    a.close();
    b.close();
  });

  it('writes nothing for a change that never reached it', async () => {
    const a = await syncedClient(board);
    expect((await boardFromStorage(board)).rows).toBe(1);

    // A socket that sends something unreadable and goes away: the board it tried to
    // change is untouched, which is the same promise from the other side.
    const stranger = await requestRoom(board, true);
    const dead = stranger.webSocket;
    if (dead === null || dead === undefined) throw new Error('no socket came back');
    dead.accept();
    dead.send(brokenUpdateFrame());
    await new Promise((resolve) => setTimeout(resolve, 100));

    const after = await boardFromStorage(board);
    expect(after.rows).toBe(1);
    expect(after.quarantined).toBe(0);
    a.close();
  });
});

/* --------------------------------------------------------- TC-13: coming back to it */

describe('reopen after everyone has gone (TC-13)', () => {
  it('reads the same board back out of the rows when the object lets go of it', async () => {
    const first = await syncedClient(board);
    drawNote(first, 'the caret stayed where I put it');
    drawNote(first, 'the note is where I left it', { x: 300, y: 200 });
    await eventually(() => expect(first.snapshot()).toHaveLength(2), {
      what: 'the notes to land',
    });
    const left = first.snapshot();

    // Both notes are in the rows before anybody leaves: a test that pulled the socket
    // while an update was still on its way would be looking at a board that had lost a
    // note, which is not the thing under test.
    await eventually(
      async () => expect(sameBoard((await boardFromStorage(board)).notes, left)).toBe(true),
      { what: 'both notes to be in the rows' },
    );

    // Everyone leaves.
    first.close();
    await eventually(
      () => expect(debugOf(board)).resolves.toMatchObject({ clients: 0 }),
      { what: 'the room to notice it is empty' },
    );

    // The board is in the rows. Read with a store that is not the room's - which is
    // what an object created from these rows would do - it is the same board, every
    // field of every note. (The runtime does not let a test ask for a genuinely new
    // object for a board, so this and the `hibernateNow` below are the two honest
    // ways to get at the same thing: the rows, and a room that has let go of its copy.)
    const stored = await boardFromStorage(board);
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    expect(sameBoard(stored.notes, left)).toBe(true);
    // It is a log of five rows and no snapshot: nothing was folded away on the way out.
    expect(stored.rows).toBe(5);
    expect(stored.chunks).toBe(0);
    expect(stored.quarantined).toBe(0);

    // Now the object lets go of the board it is holding, as an eviction would, and the
    // next person there is handed the board out of storage.
    await inBoard(board, (room) => room.hibernateNow());
    expect((await debugOf(board)).hasDocument).toBe(false);

    const back = await syncedClient(board);
    expect(sameBoard(back.snapshot(), left)).toBe(true);
    expect(await debugOf(board)).toMatchObject({ hasDocument: true, lifecycle: 'ready' });
    back.close();
  });

  it('does not lose a change between the last person leaving and the next arriving', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'saved on the way out');
    await eventually(() => expect(a.snapshot()).toHaveLength(1), { what: 'the note' });
    a.close();

    const b = await syncedClient(board);
    expect(textsOf(b.snapshot())).toEqual(['saved on the way out']);
    b.close();
  });
});

/* ------------------------------------------------------- TC-14: storage that says no */

describe('storage that cannot take a change (TC-14)', () => {
  it('tells everyone, shows nobody the change, and takes it back from the person who made it', async () => {
    const a = await syncedClient(board);
    const b = await syncedClient(board);
    drawNote(a, 'this one is saved');
    await eventually(() => expect(b.snapshot()).toHaveLength(1), { what: 'the first note' });
    await settle(board, ['this one is saved']);

    await breakStorage(board);

    const before = b.mark();
    drawNote(a, 'this one is not');
    // Nobody is left holding a change that was never written: both are closed with
    // 1011, the code for a server failure, which a client does not retry into a loop
    // the way it retries a network drop.
    await a.expectClose(CLOSE_STORAGE_FAILURE);
    await b.expectClose(CLOSE_STORAGE_FAILURE);
    // And the change that could not be written was not broadcast either: B's board is
    // the board as it was.
    expect(b.kinds(before).includes('update')).toBe(false);
    expect(textsOf(b.snapshot())).toEqual(['this one is saved']);

    // The board is intact, and without the change that went missing - because it never
    // was saved. (Four rows: one for each of the two connections - a client's own setup
    // of the board is a change like any other - and two for the note that was saved.)
    const stored = await boardFromStorage(board);
    expect(textsOf(stored.notes)).toEqual(['this one is saved']);
    expect(stored.rows).toBe(4);
    expect(stored.quarantined).toBe(0);

    // Storage takes writes again. Both come back: B first, so there is somebody to
    // tell, then A, whose document still holds the change that could not be written.
    await repairStorage(board);
    const b2 = await connectClient(board, b.doc);
    await b2.waitForSync();
    const a2 = await connectClient(board, a.doc);
    await a2.waitForSync();

    // The room asked A for what it did not have, and what A had was the change. It is
    // written now, and B is told - the change came back from the one person who was
    // still holding it, which is the only place it could have come from.
    await eventually(
      () => expect(textsOf(b2.snapshot())).toEqual(['this one is saved', 'this one is not']),
      { what: 'the change that was refused to come back from A' },
    );
    const saved = await boardFromStorage(board);
    expect(textsOf(saved.notes)).toEqual(['this one is saved', 'this one is not']);
    expect(saved.rows).toBe(5);
    expect(await debugOf(board)).toMatchObject({ lifecycle: 'ready', state: 'ready' });
    a2.close();
    b2.close();
  });

  it('leaves the rows alone, so the next load is the board as it was', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'the last good change');
    await settle(board, ['the last good change']);
    const before = await boardFromStorage(board);

    await breakStorage(board);
    drawNote(a, 'never written');
    await a.expectClose(CLOSE_STORAGE_FAILURE);

    const after = await boardFromStorage(board);
    expect(after.rows).toBe(before.rows);
    expect(after.bytes).toBe(before.bytes);
    expect(sameBoard(after.notes, before.notes)).toBe(true);
    expect(after.quarantined).toBe(0);

    // And a board whose storage came back is read again from those rows: the refused
    // change is simply not part of it, because the room does not invent one.
    await repairStorage(board);
    const later = await syncedClient(board);
    expect(sameBoard(later.snapshot(), before.notes)).toBe(true);
    later.close();
  });
});

/* --------------------------------------------- TC-15, TC-16: a board that will not open */

describe('a board that cannot be read (TC-15)', () => {
  it('closes the connection with 4500 rather than serve an empty board', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'the board that could not be read');
    await settle(board, ['the board that could not be read']);
    // A snapshot to damage. The room holds the board, so it is allowed to be folded.
    expect((await hook(board, 'compact')).json).toMatchObject({ ok: true });
    a.close();
    await eventually(
      () => expect(debugOf(board)).resolves.toMatchObject({ clients: 0 }),
      { what: 'the room to empty' },
    );

    const before = await boardFromStorage(board);
    expect(before.chunks).toBeGreaterThan(0);
    expect((await hook(board, 'corrupt-snapshot')).json).toMatchObject({ ok: true, chunks: 1 });

    const victim = await connectClient(board);
    // No board, and the client is told so with a code it can act on. Never an empty
    // board, which is the failure this whole story is about.
    await victim.expectClose(CLOSE_BOARD_LOAD_FAILED);

    // Nothing was stored on the way out: the room refused the exchange before it had
    // anything to say, so the sync traffic of a board that will not open leaves no
    // trace - no rows, no quarantine, and the damaged snapshot still in place, which is
    // what leaves repair possible.
    const after = await boardFromStorage(board);
    expect(after.load).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    expect(after.rows).toBe(0);
    expect(after.bytes).toBe(0);
    expect(after.chunks).toBe(before.chunks);
    expect(after.quarantined).toBe(0);
    expect((await debugOf(board)).state).toBe('load-failed');
  });

  it('tries again on the next connection, but not more than once per interval (TC-16)', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'four point five thousand milliseconds');
    await settle(board, ['four point five thousand milliseconds']);
    expect((await hook(board, 'compact')).json).toMatchObject({ ok: true });
    a.close();
    expect((await hook(board, 'corrupt-snapshot')).json).toMatchObject({ ok: true });

    // The first connection after the damage is refused, and the failure is recorded.
    await (await connectClient(board)).expectClose(CLOSE_BOARD_LOAD_FAILED);
    expect((await debugOf(board)).state).toBe('load-failed');

    // The board is repaired while the room is still refusing.
    expect((await hook(board, 'repair')).json).toMatchObject({ ok: true, restored: 1 });

    // A connection inside the retry interval is refused as well, even though the board
    // is readable again by now: the room has not earned another attempt. That is the
    // boundary - a room that re-read damaged storage on every connection would hammer
    // whatever is wrong with it, and would report the same failure over and over
    // instead of once per interval.
    await (await connectClient(board)).expectClose(CLOSE_BOARD_LOAD_FAILED);
    expect((await debugOf(board)).state).toBe('load-failed');

    // And the interval was the only thing that was missing.
    await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS + 300));
    const back = await syncedClient(board);
    expect(textsOf(back.snapshot())).toEqual(['four point five thousand milliseconds']);
    expect(await debugOf(board)).toMatchObject({ lifecycle: 'ready', state: 'ready' });
    back.close();
    // This test waits out `LOAD_RETRY_MIN_INTERVAL_MS` on purpose: the interval is what
    // it is checking, and there is no other way to check it than by when the next
    // connection is answered.
  }, LOAD_RETRY_MIN_INTERVAL_MS + 20_000);

  it('says so when the read itself fails, and damages nothing on the way', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'the board that could not be read back');
    await settle(board, ['the board that could not be read back']);
    const before = await boardFromStorage(board);

    // Not damaged rows this time: the SELECT that walks the log throws, which is what
    // storage that is there but not working looks like.
    await breakLogRead(board);
    await inBoard(board, (room) => room.hibernateNow());

    await (await connectClient(board)).expectClose(CLOSE_BOARD_LOAD_FAILED);
    expect((await debugOf(board)).state).toBe('load-failed');

    // The room's own read failed, so the board it refused is exactly the board that was
    // there before: same rows, same bytes, nothing quarantined.
    await repairLogRead(board);
    const after = await boardFromStorage(board);
    expect(sameBoard(after.notes, before.notes)).toBe(true);
    expect(after.rows).toBe(before.rows);
    expect(after.quarantined).toBe(0);
    a.close();
  });
});

/* --------------------------------------------------------- TC-17: messages that are not */

describe('a message that is not a message (TC-17)', () => {
  it('closes the socket that sent garbage and stores nothing', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'the board before the garbage');
    // Wait for the note to be *in storage* rather than merely made, so the count below
    // is a settled one and not a race with the room's own write.
    await eventually(
      async () =>
        expect(textsOf((await boardFromStorage(board)).notes)).toEqual([
          'the board before the garbage',
        ]),
      { what: 'the note to be in storage' },
    );
    const before = await boardFromStorage(board);

    a.send(brokenUpdateFrame());
    await a.expectClose(CLOSE_UNSUPPORTED_DATA);

    const after = await boardFromStorage(board);
    // The row count did not move. An update that could not be read was never a change,
    // so there is nothing to write and nothing to quarantine.
    expect(after.rows).toBe(before.rows);
    expect(after.quarantined).toBe(0);
    expect(sameBoard(after.notes, before.notes)).toBe(true);
  });

  it('closes the socket that sends a text frame, and nobody else notices', async () => {
    const a = await syncedClient(board);
    const b = await syncedClient(board);
    drawNote(b, 'still here');
    await settle(board, ['still here']);

    a.send('hello, is this a board?');
    await a.expectClose(CLOSE_UNSUPPORTED_DATA);
    await b.expectOpen(300);
    expect(textsOf(b.snapshot())).toEqual(['still here']);
    b.close();
  });
});

/* --------------------------------------------- TC-18: the object gone, the sockets left */

describe('an object that was thrown out while people were still on it (TC-18)', () => {
  it('reads the board back when a message arrives on a socket that was already there', async () => {
    const holder = await syncedClient(board);
    drawNote(holder, 'the board outlived the object');
    await settle(board, ['the board outlived the object']);

    // A second person whose document has never seen this board and who has not asked
    // for anything yet: this is the socket that will still be open when the object is
    // gone, and the only one that can show the board arriving. Its document is bare on
    // purpose - a document that already had the board would be handed nothing back, and
    // the test would be watching for a frame that correctly never comes.
    const quiet = await connectClient(board, new Y.Doc());
    // Let whatever the handshake had in flight land first: a frame that arrives on this
    // socket would wake the room on its own, and the test would be measuring that.
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The object is evicted. The runtime keeps the sockets - that is what
    // `acceptWebSocket` buys - but the board in memory is not there any more.
    await inBoard(board, (room) => room.hibernateNow());
    expect(await debugOf(board)).toMatchObject({ hasDocument: false, clients: 2 });

    // The first thing that socket sends is its SyncStep1. The room has to go and read
    // the board before it can answer, and what it answers with has to be the board.
    quiet.send(syncStep1Frame(quiet.doc));
    await eventually(
      () => expect(quiet.snapshot()).toHaveLength(1),
      { what: 'the board to be read back for a socket that was already open' },
    );
    expect(quiet.snapshot()[0]?.text).toBe('the board outlived the object');
    expect(await debugOf(board)).toMatchObject({ hasDocument: true, lifecycle: 'ready' });

    // The other socket is still a connection to the same board, and a change made after
    // the wake reaches it - which it can only do if the room is relaying through the
    // sockets the runtime holds, not a set of its own.
    drawNote(quiet, 'made after the wake');
    await eventually(
      () => expect(holder.snapshot()).toHaveLength(2),
      { what: 'the change to reach the socket that was already open' },
    );
    holder.close();
    quiet.close();
  });

  it('does not hand an unloaded board to a socket that arrives in the middle', async () => {
    const a = await syncedClient(board);
    drawNote(a, 'two people, one board');
    await settle(board, ['two people, one board']);

    // The object drops the board with someone still on it, and then a new person
    // arrives: the load has to happen, and happen once.
    await inBoard(board, (room) => room.hibernateNow());
    const newcomer = await connectClient(board);
    await newcomer.waitForSync();
    expect(sameBoard(newcomer.snapshot(), a.snapshot())).toBe(true);

    drawNote(a, 'the second note');
    await eventually(
      () => expect(newcomer.snapshot()).toHaveLength(2),
      { what: 'the second note to reach the newcomer' },
    );
    a.close();
    newcomer.close();
  });
});

/* ---------------------------------------------------------------- the test routes */

describe('the routes the persistence tests are built on (task 9 hooks)', () => {
  it('seeds a board through the model, and the notes are in the rows', async () => {
    const a = await syncedClient(board);
    const seeded = await hook(board, 'seed', { notes: 5, textLength: 12 });
    expect(seeded.status).toBe(200);
    expect(seeded.json).toMatchObject({ ok: true, added: 5 });

    // The seeded notes came through the same document, and the same update path, that a
    // client's notes come through - so the person already on the board sees them, and
    // they land in the log like any other change.
    await eventually(() => expect(a.snapshot()).toHaveLength(5), { what: 'the seeded notes' });
    const seen = a.snapshot();
    expect(new Set(seen.map((note) => note.color)).size).toBeGreaterThan(1);
    expect(seen.every((note) => note.text.length > 0)).toBe(true);

    // Two rows for each note - creation and text - and one for the connection that was
    // there when they were seeded: a board written change by change.
    const stored = await boardFromStorage(board);
    expect(stored.rows).toBe(11);
    expect(sameBoard(stored.notes, seen)).toBe(true);
    a.close();

    // And it is still the board after the room stops holding it.
    await inBoard(board, (room) => room.hibernateNow());
    const back = await syncedClient(board);
    expect(sameBoard(back.snapshot(), seen)).toBe(true);
    back.close();
  });

  it('compacts a board that has not earned it yet, and the board opens from the snapshot alone', async () => {
    const a = await syncedClient(board);
    expect((await hook(board, 'seed', { notes: 8, textLength: 40 })).json).toMatchObject({
      ok: true,
      added: 8,
    });
    await eventually(() => expect(a.snapshot()).toHaveLength(8), { what: 'the seeded notes' });
    const before = a.snapshot();

    const compacted = await hook(board, 'compact');
    expect(compacted.json).toMatchObject({ ok: true, updateRows: 0 });
    expect(compacted.json['chunkRows']).toBeGreaterThan(0);

    // Every row the snapshot covers is gone. A load reads the snapshot and whatever came
    // after it - which is nothing: this is "an object woken in under a second does not
    // replay rows the snapshot already covers", at a size a test can reach by asking.
    const stored = await boardFromStorage(board);
    expect(stored.rows).toBe(0);
    expect(stored.chunks).toBeGreaterThan(0);
    expect(sameBoard(stored.notes, before)).toBe(true);

    a.close();
    const back = await syncedClient(board);
    expect(sameBoard(back.snapshot(), before)).toBe(true);
    back.close();
  });

  it('damages a snapshot and puts it back, and the board comes round', async () => {
    const a = await syncedClient(board);
    expect((await hook(board, 'seed', { notes: 3, textLength: 8 })).json).toMatchObject({
      ok: true,
      added: 3,
    });
    await eventually(() => expect(a.snapshot()).toHaveLength(3), { what: 'the seeded notes' });
    const before = a.snapshot();
    expect((await hook(board, 'compact')).json).toMatchObject({ ok: true });
    a.close();

    expect((await hook(board, 'corrupt-snapshot')).json).toMatchObject({ ok: true });
    await (await connectClient(board)).expectClose(CLOSE_BOARD_LOAD_FAILED);

    expect((await hook(board, 'repair')).json).toMatchObject({ ok: true, restored: 1 });
    // The room is inside its retry interval, which is TC-16's business and not this
    // one's. What this checks is that the damage was reversible through the same rows:
    // the board is back, read from storage.
    const stored = await boardFromStorage(board);
    expect(sameBoard(stored.notes, before)).toBe(true);
  });

  it('refuses a route that is not a route, and a board id that is not a board id', async () => {
    // Not one of the actions: not a route, so the asset bucket is asked, and it says no.
    expect((await hook(board, 'no-such-action')).status).not.toBe(200);
    expect(
      (
        await SELF.fetch('http://localhost/__test/boards/not-a-board-id/seed', { method: 'POST' })
      ).status,
    ).toBe(400);
    // Nothing behind that path but the asset bucket, which is not asked to POST and says
    // so. The point is that no room was woken for an empty board id.
    expect([404, 405]).toContain(
      (await SELF.fetch('http://localhost/__test/boards/', { method: 'POST' })).status,
    );
  });

  it('does not treat the test path as a board', async () => {
    // The routes belong to a board's object and are POSTed to. An upgrade request to one
    // of the paths is not a connection to a board, whatever else it turns into.
    const response = await requestRoom(`/__test/boards/${board}/seed`, true);
    expect(response.status).not.toBe(101);
  });
});

/* -------------------------------------------------- a check the story asks to keep */

describe('everybody on the board', () => {
  it('holds every connection, and the same board for all of them', async () => {
    const clients: Client[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
      clients.push(await syncedClient(board));
    }
    drawNote(clients[0]!, 'everyone is on the same board');
    await eventually(
      () => expect(clients.every((client) => client.snapshot().length === 1)).toBe(true),
      { what: 'everyone to have the note' },
    );

    // One board, one object holding it, and all of their changes in one log: a row for
    // every connection plus two for the note, which is what a board that stores every
    // change is. Nobody was turned away at the door.
    expect(await debugOf(board)).toMatchObject({
      clients: MAX_CONCURRENT_EDITORS,
      lifecycle: 'ready',
    });
    expect((await boardFromStorage(board)).rows).toBe(MAX_CONCURRENT_EDITORS + 2);
    for (const client of clients) client.close();
  });
});
