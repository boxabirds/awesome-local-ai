/**
 * Persistent room integration tests (TC-12 to TC-18, TC-26).
 *
 * These are the promises story 4 makes to a person closing their tab: that a change they can
 * see is a change that was written down before it was shown; that a board nobody is looking at
 * comes back identical when someone opens it again, in a room object that has never seen it;
 * that a board which cannot be read says so instead of opening empty; and that a board whose
 * storage has stopped working stops rather than pretend.
 *
 * Everything here is real: real `Y.Doc`s on real WebSockets to a real SQLite-backed Durable
 * Object, with the object evicted from memory when a test needs a cold start - because "we lose
 * nothing" is a claim about the bytes in storage, and it can only be checked against them.
 */
import { describe, expect, test } from 'vitest';
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  LOAD_RETRY_MIN_INTERVAL_MS,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { BoardStore, type LoadResult } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { newDoc, sameBoardState, unreadableSnapshot } from '../fixtures/boards';
import {
  closeAll,
  connect,
  converge,
  ensureBoard,
  SYNC_UPDATE,
  waitFor,
  type RoomClient,
} from './ws-client';

/** Lets in-flight frames arrive before an assertion is made. */
function rest(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubFor(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Runs `fn` inside the board's room object, with its raw storage state. */
async function inRoom<T>(
  boardId: string,
  fn: (room: BoardRoom, state: DurableObjectState) => T,
): Promise<T> {
  return runInDurableObject(stubFor(boardId), (room, state) => fn(room, state));
}

function countRows(state: DurableObjectState, table: string): number {
  return state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

/** What the board's storage holds right now, read by a store that has never met the room. */
async function boardInStorage(boardId: string): Promise<{
  load: LoadResult;
  notes: readonly StickySnapshot[];
  rows: number;
  chunks: number;
  quarantined: number;
}> {
  return inRoom(boardId, (_room, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    const doc = newDoc();
    const load = store.load(doc);
    return {
      load,
      notes: snapshot(doc),
      rows: countRows(state, 'updates'),
      chunks: countRows(state, 'snapshot_chunks'),
      quarantined: countRows(state, 'quarantined_updates'),
    };
  });
}

/** A board with something of everything the model can express, written through one document. */
function writeVariedBoard(doc: Y.Doc): number {
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  const ids: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const id = createSticky(
      doc,
      { x: index * 37 - 500.5, y: (index % 5) * 90 + 0.25 },
      colors[index % colors.length],
    );
    getStickyText(doc, id)?.insert(0, `note ${index}\nsecond line`);
    ids.push(id);
  }
  const first = ids[0];
  const second = ids[1];
  const last = ids[11];
  if (!first || !second || !last) throw new Error('the board did not get its notes');
  moveObject(doc, first, 1234.5, -4321.25);
  setStickyColor(doc, first, 'violet');
  bringToFront(doc, second);
  deleteObject(doc, last);
  return ids.length - 1;
}

/**
 * Sends this client's whole state as a SyncStep2 whether or not the room asked for it.
 *
 * The point of doing it to a room that is turning the client away: whatever the room decides to
 * answer, a state it refuses must not be a state it stores.
 */
function pushState(client: RoomClient): void {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep2(encoder, client.doc);
  try {
    client.sendSync(encoding.toUint8Array(encoder));
  } catch {
    // the room had already closed the connection: that is the answer this test is about
  }
}

describe('a change is written before it is seen (TC-12)', () => {
  test('TC-12: when B sees A\'s note, the note is in storage', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const a = await connect(boardId);
    const b = await connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 240, y: 180 }, 'green');
    getStickyText(a.doc, id)?.insert(0, 'written down before it was shown');
    await waitFor(() => b.notes().length === 1, 5000, 'B never received A\'s note');

    // the observation implies the row: storage is read after B saw it, not before
    const stored = await boardInStorage(boardId);
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    expect(stored.notes).toEqual(b.notes());
    expect(stored.notes.at(0)?.text).toBe('written down before it was shown');
    expect(stored.rows).toBeGreaterThan(0);

    closeAll([a, b]);
  });

  test('TC-12: a change every client can see is one row per change, not one per client', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const clients = [
      await connect(boardId),
      await connect(boardId),
      await connect(boardId),
    ];
    for (const client of clients) await client.waitForSync();
    await converge(clients);

    const rowsAfterJoin = (await boardInStorage(boardId)).rows;
    for (let note = 0; note < 5; note += 1) {
      createSticky(clients[note % clients.length]!.doc, { x: note * 60, y: note * 20 });
    }
    await converge(clients);
    expect(clients[0]!.notes()).toHaveLength(5);

    // five changes made by three tabs: five rows arrive at the room, relayed ones are not
    // written a second time
    const stored = await boardInStorage(boardId);
    expect(stored.rows - rowsAfterJoin).toBe(5);
    expect(stored.notes).toHaveLength(5);

    closeAll(clients);
  });
});

describe('a board comes back when nobody is looking (TC-13)', () => {
  test('TC-13: reopening after everybody leaves gives the same board, in a room that never saw it', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const a = await connect(boardId);
    await a.waitForSync();
    const notes = writeVariedBoard(a.doc);
    await rest(200);

    const before = JSON.stringify(a.notes());
    expect(snapshot(a.doc)).toHaveLength(notes);

    closeAll([a]);
    await rest(150);
    // the runtime forgets this board entirely: no document, no sockets, no memory
    await evictDurableObject(stubFor(boardId), { webSockets: 'close' });

    // a client that writes nothing of its own, so what it ends up holding is what storage gave
    const late = await connect(boardId, { init: false });
    await late.waitForSync();

    expect(JSON.stringify(late.notes())).toBe(before);
    expect(late.notes()).toHaveLength(notes);
    // byte for byte, not "the same number of notes": position, colour, text and stacking
    expect(sameBoardState(late.doc, a.doc)).toBe(true);

    const stored = await boardInStorage(boardId);
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    expect(JSON.stringify(stored.notes)).toBe(before);

    closeAll([late]);
  });

  test('TC-13: a board reopened by two clients at once converges and stays stored', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const seed = await connect(boardId);
    await seed.waitForSync();
    writeVariedBoard(seed.doc);
    await rest(200);
    closeAll([seed]);
    await rest(100);
    await evictDurableObject(stubFor(boardId), { webSockets: 'close' });

    const [late, later] = await Promise.all([connect(boardId), connect(boardId)]);
    await late.waitForSync();
    await later.waitForSync();
    await converge([late, later]);
    expect(late.notes()).toHaveLength(11);
    // both tabs hold the same board the seed had
    expect(late.notes().at(0)).toEqual(seed.notes().at(0));

    createSticky(late.doc, { x: 0, y: 0 }, 'pink');
    await converge([late, later]);
    expect(later.notes()).toHaveLength(12);
    expect((await boardInStorage(boardId)).notes).toHaveLength(12);

    closeAll([late, later]);
  });
});

describe('storage that stops working (TC-14, TC-26)', () => {
  test('TC-14: a change that could not be saved is not shown to anybody, and survives on the client that made it', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const a = await connect(boardId);
    const b = await connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    const framesOnB = b.updateFrames();

    await inRoom(boardId, (room) => {
      room.store.failNext = 'append';
    });

    createSticky(a.doc, { x: 5, y: 5 }, 'pink');

    const [closeA, closeB] = await Promise.all([a.waitForClose(), b.waitForClose()]);
    expect(closeA.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(closeB.code).toBe(CLOSE_STORAGE_FAILURE);
    // the change was never broadcast: B saw nothing at all
    expect(b.updateFrames()).toBe(framesOnB);
    expect(b.notes()).toHaveLength(0);
    // and it is not in storage either - which is why nobody was told about it
    expect((await boardInStorage(boardId)).notes).toHaveLength(0);

    // A still holds the note locally; reconnecting offers it again, and this time it lands
    const back = await connect(boardId, { doc: a.doc });
    await back.waitForSync();
    const bBack = await connect(boardId, { doc: b.doc });
    await bBack.waitForSync();
    await converge([back, bBack]);

    expect(bBack.notes()).toHaveLength(1);
    expect(bBack.notes().at(0)?.color).toBe('pink');
    const stored = await boardInStorage(boardId);
    expect(stored.notes).toHaveLength(1);
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });

    closeAll([back, bBack]);
  });

  test('TC-26: a room that cannot read its storage closes clients with 4500', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const a = await connect(boardId);
    const b = await connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    createSticky(a.doc, { x: 1, y: 1 });
    await converge([a, b]);

    // the board stops because a write failed, and the room drops its document
    await inRoom(boardId, (room) => {
      room.store.failNext = 'append';
    });
    createSticky(a.doc, { x: 2, y: 2 });
    await Promise.all([a.waitForClose(), b.waitForClose()]);
    expect(a.closes.at(0)?.code).toBe(CLOSE_STORAGE_FAILURE);

    // the reconnect rebuilds the document from storage - and storage now refuses to be read
    await inRoom(boardId, (room) => {
      room.store.failNext = 'load';
    });
    const late = await connect(boardId);
    const closed = await late.waitForClose();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    // a board that could not be read is not served as an empty one: the room keeps its bytes
    expect(a.notes().length).toBeGreaterThan(0);
    expect(late.notes()).toHaveLength(0);
    const stored = await boardInStorage(boardId);
    expect(stored.load.ok).toBe(true);
    expect(stored.notes).toHaveLength(1);

    closeAll([late]);
  });
});

describe('a board that cannot be loaded (TC-15, TC-16)', () => {
  /** Seed a readable board, then make its snapshot unreadable and forget the room. */
  async function breakSnapshot(boardId: string): Promise<void> {
    const seed = await connect(boardId);
    await seed.waitForSync();
    createSticky(seed.doc, { x: 10, y: 10 });
    createSticky(seed.doc, { x: 40, y: 10 }, 'blue');
    await rest(200);
    closeAll([seed]);
    await rest(100);

    await inRoom(boardId, (_room, state) => {
      state.storage.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?)',
        unreadableSnapshot(),
      );
    });
    await evictDurableObject(stubFor(boardId), { webSockets: 'close' });
  }

  test('TC-15: an unreadable snapshot closes the client with 4500 and stores nothing', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    await breakSnapshot(boardId);
    const rowsBefore = (await boardInStorage(boardId)).rows;

    const client = await connect(boardId);
    // a client that offers its whole state before being turned away: the room must not take it
    pushState(client);
    const closed = await client.waitForClose();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    await rest(150);

    const stored = await boardInStorage(boardId);
    expect(stored.load.ok).toBe(false);
    expect(stored.load.ok === false && stored.load.reason).toBe('snapshot-unreadable');
    // nothing was written by the attempt: not the offered state, not a repaired snapshot
    expect(stored.rows).toBe(rowsBefore);
    expect(stored.chunks).toBe(1);
    expect(stored.quarantined).toBe(0);

    closeAll([client]);
  });

  test('TC-16: a broken board is not read again until the retry interval has passed', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    await breakSnapshot(boardId);

    const first = await connect(boardId);
    expect((await first.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    const attempts = await inRoom(boardId, (room) => room.store.loadAttempts);
    expect(attempts).toBe(1);

    // a tab that hits reload immediately is refused from the state alone, without a read
    const second = await connect(boardId);
    expect((await second.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await inRoom(boardId, (room) => room.store.loadAttempts)).toBe(attempts);

    // somebody fixes the storage - the snapshot rows were the broken part, the log is intact
    await inRoom(boardId, (_room, state) => {
      state.storage.sql.exec('DELETE FROM snapshot_chunks');
    });

    // ...and not until the interval has passed does the room look again
    await rest(LOAD_RETRY_MIN_INTERVAL_MS + 150);
    const third = await connect(boardId);
    await third.waitForSync();
    expect(third.notes()).toHaveLength(2);
    expect(await inRoom(boardId, (room) => room.store.loadAttempts)).toBe(attempts + 1);

    // and it stays open: the next visitor needs no repair
    const fourth = await connect(boardId);
    await fourth.waitForSync();
    await converge([third, fourth]);
    expect(fourth.notes()).toHaveLength(2);

    closeAll([third, fourth]);
  }, LOAD_RETRY_MIN_INTERVAL_MS + 30_000);
});

describe('frames that are not usable (TC-17)', () => {
  test('TC-17: a garbage update closes that client and adds no rows', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const honest = await connect(boardId);
    await honest.waitForSync();
    const attacker = await connect(boardId, { init: false });
    await attacker.waitForSync();
    const storedBefore = await boardInStorage(boardId);

    // well framed, and the payload is something Yjs cannot apply
    attacker.sendSync(new Uint8Array([SYNC_UPDATE, 3, 9, 9, 9]));

    const closed = await attacker.waitForClose();
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);
    await rest(150);

    const stored = await boardInStorage(boardId);
    expect(stored.rows).toBe(storedBefore.rows);
    expect(stored.quarantined).toBe(0);

    // the board carries on for everybody else, and their changes are still written
    createSticky(honest.doc, { x: 0, y: 0 }, 'orange');
    await rest(200);
    const after = await boardInStorage(boardId);
    expect(after.rows).toBe(stored.rows + 1);
    expect(after.notes).toHaveLength(1);

    closeAll([honest]);
  });

  test('TC-17: a frame that is not this protocol closes that client and leaves the board alone', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const honest = await connect(boardId);
    await honest.waitForSync();
    const rowsBefore = (await boardInStorage(boardId)).rows;

    // a frame whose outer type is not part of the protocol at all
    const attacker = await connect(boardId, { init: false });
    await attacker.waitForSync();
    attacker.sendBytes(new Uint8Array([200, 1, 2, 3]));
    expect((await attacker.waitForClose()).code).toBe(CLOSE_UNSUPPORTED_DATA);

    // and a text frame, which no y-websocket client has ever sent
    const stranger = await connect(boardId, { init: false });
    await stranger.waitForSync();
    stranger.sendText('hello?');
    expect((await stranger.waitForClose()).code).toBe(CLOSE_UNSUPPORTED_DATA);

    await rest(100);
    expect((await boardInStorage(boardId)).rows).toBe(rowsBefore);
    expect(honest.closes).toHaveLength(0);

    closeAll([honest]);
  });
});

describe('a room that was evicted while people were connected (TC-18)', () => {
  test('TC-18: after the room is rebuilt, frames on sockets accepted earlier are stored and delivered', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const a = await connect(boardId);
    const b = await connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    createSticky(a.doc, { x: 0, y: 0 });
    await converge([a, b]);
    await rest(150);

    // the runtime evicts the object with both tabs still connected: no document, no socket
    // objects, only the hibernating connections and what is in storage
    await evictDurableObject(stubFor(boardId), { webSockets: 'hibernate' });

    // B's next frame wakes the room. It has to find both sockets again through the runtime.
    const id = createSticky(b.doc, { x: 300, y: 40 }, 'blue');
    getStickyText(b.doc, id)?.insert(0, 'made after the room was gone');
    await waitFor(() => a.notes().length === 2, 5000, 'A never received the note');

    const woke = await inRoom(boardId, (room, state) => ({
      // the runtime's own list, not one the room keeps: this is what a woken room has to find
      sockets: state.getWebSockets().length,
      loadAttempts: room.store.loadAttempts,
    }));
    // the room that handled that frame was built from scratch and read the board back
    expect(woke.loadAttempts).toBe(1);
    // and it is holding both hibernated connections, not just the one that woke it
    expect(woke.sockets).toBe(2);

    const stored = await boardInStorage(boardId);
    expect(stored.notes).toHaveLength(2);
    expect(stored.notes.at(1)?.text).toBe('made after the room was gone');
    expect(sameBoardState(a.doc, b.doc)).toBe(true);

    closeAll([a, b]);
  });
});
