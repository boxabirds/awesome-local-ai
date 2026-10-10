import { describe, it, expect, afterEach } from 'vitest';
import { reset, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { BoardStore, type BoardStorage, type SqlCursor, type SqlValue, type SqlStorageLike } from '../../src/worker/board-store';
import { retroBoard, batchUpdates, boardKey, RETRO_NOTE_COUNT } from '../fixtures/boards';
import {
  addSticky,
  bindings,
  connectRoom,
  newBoardIdFor,
  openClient,
  ProtocolClient,
  reconnect,
  roomSnapshot,
  settle,
  updateFrame,
} from './helpers/room';

/**
 * TC-12 to TC-18, TC-26 (anchor `persist.storage`, `persist.reload`,
 * `persist.load_failure`).
 *
 * Everything here runs against the real Durable Object SQLite of the real
 * `BoardRoom`, driven by real protocol clients. The board under test is always
 * read back two ways: through the room's own document, and through a document
 * built only from the stored rows, which is what a reload actually produces.
 *
 * The dimension class of each run (D1 stored state, D2 storage failure, D3
 * damage, D4 connection behaviour, D6 scale) is named in the test title.
 */

const OPEN: { close(): void }[] = [];

afterEach(async () => {
  for (const socket of OPEN.splice(0)) {
    try {
      socket.close();
    } catch {
      // Already gone.
    }
  }
  await reset();
});

const keep = <T extends { close(): void }>(thing: T): T => {
  OPEN.push(thing);
  return thing;
};

const join = async (board: string): Promise<ProtocolClient> => keep(await openClient(board));

const roomStub = (board: string) => {
  const ns = bindings().BOARD_ROOM;
  return ns.get(ns.idFromName(board));
};

/**
 * A document built only from what is stored, which is what a reload makes.
 * Nothing is written back: `load` is a read.
 */
const storedBoard = async (board: string): Promise<readonly StickySnapshot[]> =>
  runInDurableObject(roomStub(board), (instance) => {
    const doc = new Y.Doc();
    const result = instance.testStore().load(doc);
    if (!result.ok) {
      throw new Error(`stored board did not load: ${result.reason}`);
    }
    return snapshot(doc);
  });

/** Row counts and byte totals for this board's tables. */
const storeStats = async (board: string) => runInDurableObject(roomStub(board), (i) => i.testStats());

const roomState = async (board: string) => runInDurableObject(roomStub(board), (i) => i.testState());

const texts = (notes: readonly StickySnapshot[]): string[] => notes.map((note) => note.text).sort();

/** Connect, and expect the room to close the socket instead of serving it. */
const connectUntilClosed = async (board: string): Promise<{ code: number; reason: string }> => {
  const socket = keep(await connectRoom(board));
  return socket.closed(5_000);
};

/* ---------------------------------------------------------------------------
 * Injected storage behaviour (TC-14, TC-26)
 * ------------------------------------------------------------------------- */

/** A store whose next write throws, once. */
class FailOnceStore extends BoardStore {
  private armed = true;
  override append(update: Uint8Array): void {
    if (this.armed) {
      this.armed = false;
      throw new Error('simulated: storage is full');
    }
    super.append(update);
  }
}

/** A storage wrapper whose every `SELECT` throws (TC-26). */
class SelectThrows implements BoardStorage {
  private readonly inner: BoardStorage;
  constructor(inner: BoardStorage) {
    this.inner = inner;
  }
  get sql(): SqlStorageLike {
    const sql = this.inner.sql;
    return {
      exec: (query: string, ...values: SqlValue[]): SqlCursor =>
        /^\s*SELECT/i.test(query)
          ? (() => {
              throw new Error('simulated: read failed');
            })()
          : sql.exec(query, ...values),
    };
  }
  transactionSync<T>(closure: () => T): T {
    return this.inner.transactionSync(closure);
  }
}

/* ---------------------------------------------------------------------------
 * TC-12 / TC-13: writing and reopening
 * ------------------------------------------------------------------------- */

describe('what a board stores, and what reopening it reads back (persist.storage, persist.reload)', () => {
  it('TC-12: an update is stored before another client sees it (D1 fresh board/D2 1 writer/D4 steady)', async () => {
    const board = newBoardIdFor('tc12');
    const a = await join(board);
    const b = await join(board);

    const before = b.updateCount();
    a.edit((doc) => {
      addSticky(doc, 40, 40, 'stored before shown');
    });
    await b.waitForUpdates(before + 1);

    // The moment B had the change, the row was already there.
    const stats = await storeStats(board);
    expect(stats.updateRows).toBe(1);

    // And the stored bytes are enough on their own to make the board.
    expect(texts(await storedBoard(board))).toEqual(['stored before shown']);
  });

  it('TC-13: reopening after everyone left shows 25 notes as they were left (D1 25 rows/D4 reconnect)', async () => {
    const board = newBoardIdFor('tc13');
    const fixture = retroBoard();
    const a = await join(board);

    // The fixture's mutations arrive as five batches, which is how a person
    // editing over time produces a log.
    for (const batch of batchUpdates(fixture.updates, 5)) {
      a.edit((doc) => {
        Y.applyUpdate(doc, batch);
      });
    }
    await settle(400);
    expect(a.snapshot()).toHaveLength(RETRO_NOTE_COUNT);

    // Everyone leaves.
    a.close();
    await a.socket.closed(3_000).catch(() => null);
    await settle(300);
    // With the last socket gone the room has nothing to hold onto.
    expect((await roomState(board)).state).toBe('hibernated');

    // A new connection meets a room that is holding no board in memory - the
    // state a reconstructed object starts in - and it rebuilds one from rows.
    await runInDurableObject(roomStub(board), (instance) => {
      instance.testForgetDoc();
      return true;
    });

    const late = await join(board);
    expect(late.snapshot()).toHaveLength(RETRO_NOTE_COUNT);
    expect(boardKey(late.snapshot())).toBe(boardKey(fixture.notes));
    expect(boardKey(await storedBoard(board))).toBe(boardKey(fixture.notes));
    expect((await roomState(board)).state).toBe('ready');
  });

  it('TC-25: opening a board nobody has edited stores nothing (D1 empty)', async () => {
    const board = newBoardIdFor('tc25');
    const a = await join(board);
    const b = await join(board);

    expect(await roomSnapshot(board)).toHaveLength(0);
    const stats = await storeStats(board);
    expect(stats.updateRows).toBe(0);
    expect(stats.snapshotChunks).toBe(0);
    expect(stats.quarantinedRows).toBe(0);

    a.edit((doc) => {
      addSticky(doc, 0, 0, 'first change');
    });
    await settle(200);
    expect(b.snapshot().map((note) => note.text)).toEqual(['first change']);
    expect((await storeStats(board)).updateRows).toBe(1);
  });
});

/* ---------------------------------------------------------------------------
 * TC-14 / TC-26: storage that fails
 * ------------------------------------------------------------------------- */

describe('a board that cannot be saved or read (persist.load_failure)', () => {
  it('TC-14: a failed write is not shown to anyone, and the board recovers (D2 write failure/D4 reconnect)', async () => {
    const board = newBoardIdFor('tc14');
    const stub = roomStub(board);

    const a = await join(board);
    const b = await join(board);
    // Let the room store something first, so the failure is a failure of a
    // board that already has rows.
    a.edit((doc) => {
      addSticky(doc, 10, 10, 'saved safely');
    });
    await b.waitForUpdates(1);
    expect((await storeStats(board)).updateRows).toBe(1);

    await runInDurableObject(stub, (instance) => {
      instance.testUseStore(new FailOnceStore(instance.testStorage()));
      return true;
    });

    const before = b.updateCount();
    a.edit((doc) => {
      addSticky(doc, 20, 20, 'never saved');
    });

    const closedA = await a.socket.closed(3_000);
    const closedB = await b.socket.closed(3_000);
    expect(closedA.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(closedB.code).toBe(CLOSE_STORAGE_FAILURE);

    // Nobody was shown the change that could not be stored ...
    expect(b.updateCount()).toBe(before);
    // ... and it did not reach the log either.
    expect((await storeStats(board)).updateRows).toBe(1);
    expect((await roomState(board)).state).toBe('storage-failed');

    // Opening the board again rebuilds it, and the person who still holds the
    // unsaved change brings it with them.
    const back = await reconnect(a, board);
    keep(back);
    await settle(300);
    expect((await roomState(board)).state).toBe('ready');
    expect(texts(await storedBoard(board))).toEqual(['never saved', 'saved safely']);

    const newcomer = await join(board);
    expect(texts(newcomer.snapshot())).toEqual(['never saved', 'saved safely']);
  });

  it('TC-26: a room that cannot read its board closes every socket with 4500 (D3 read failure/D4 close)', async () => {
    const board = newBoardIdFor('tc26');
    const stub = roomStub(board);
    const a = await join(board);
    a.edit((doc) => {
      addSticky(doc, 10, 10, 'readable once');
    });
    await settle(200);

    // Inject a store whose SELECT throws, and ask the room to read the board.
    const result = await runInDurableObject(stub, (instance) => {
      instance.testUseStore(new BoardStore(new SelectThrows(instance.testStorage())));
      return instance.testLoad();
    });
    expect(result.ok).toBe(false);
    expect((await roomState(board)).state).toBe('load-failed');

    // The socket it was already serving is closed, not left hanging.
    const closed = await a.socket.closed(3_000);
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Anyone else who tries is closed the same way, with the load-failure code.
    expect((await connectUntilClosed(board)).code).toBe(CLOSE_BOARD_LOAD_FAILED);
  });

  it('TC-17: a frame that is not a valid update closes the client and stores nothing (D2 damaged update)', async () => {
    const board = newBoardIdFor('tc17');
    const client = await join(board);

    client.socket.send(updateFrame(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255])));
    const closed = await client.socket.closed(3_000);
    expect(closed.code).toBe(1003);

    const stats = await storeStats(board);
    expect(stats.updateRows).toBe(0);
    expect(stats.quarantinedRows).toBe(0);
  });
});

/* ---------------------------------------------------------------------------
 * TC-15 / TC-16: a snapshot that cannot be read
 * ------------------------------------------------------------------------- */

describe('a damaged snapshot (persist.load_failure, persist.client_status)', () => {
  it('TC-15: a client is closed with 4500 and nothing is stored (D1 snapshot/D3 damaged snapshot/D4 close)', async () => {
    const board = newBoardIdFor('tc15');
    const stub = roomStub(board);
    const a = await join(board);
    a.edit((doc) => {
      addSticky(doc, 10, 10, 'in the snapshot');
    });
    await settle(200);

    // Fold it into a snapshot, then damage the snapshot.
    expect(await runInDurableObject(stub, (instance) => instance.testCompactNow())).toBe(true);
    expect((await storeStats(board)).snapshotChunks).toBe(1);
    expect((await storeStats(board)).updateRows).toBe(0);
    expect(await runInDurableObject(stub, (instance) => instance.testCorruptSnapshot())).toMatchObject({
      ok: true,
    });

    // Reading the board again is what a new connection would do, and it fails
    // the same way: the damage is in the snapshot, not in a log row.
    const reload = await runInDurableObject(stub, (instance) => instance.testLoad());
    expect(reload.ok).toBe(false);
    await settle(300);

    const closed = await connectUntilClosed(board);
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Nothing the closed client would have sent is stored, and nothing was
    // quarantined: a snapshot is not a log row.
    const stats = await storeStats(board);
    expect(stats.updateRows).toBe(0);
    expect(stats.quarantinedRows).toBe(0);
  });

  it('TC-16: reconnecting clients do not make the room reload on every attempt (D3 damaged snapshot/D4 reconnect)', async () => {
    const board = newBoardIdFor('tc16');
    const stub = roomStub(board);
    const a = await join(board);
    a.edit((doc) => {
      addSticky(doc, 10, 10, 'waiting to be read');
    });
    await settle(200);
    await runInDurableObject(stub, (instance) => instance.testCompactNow());
    await runInDurableObject(stub, (instance) => instance.testCorruptSnapshot());

    // A reload finds the damage: the room reads storage, fails, and lets go of
    // the board and the sockets it was serving.
    await runInDurableObject(stub, (instance) => instance.testLoad());
    await settle(300);

    // Three attempts in quick succession: only the one above read storage.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await connectUntilClosed(board)).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    }
    const state = await roomState(board);
    expect(state.state).toBe('load-failed');
    expect(state.loadAttempts).toBe(2); // the room's own, then the reload

    // Repair it, and let the room become old enough to try again.
    expect(await runInDurableObject(stub, (instance) => instance.testRepairSnapshot())).toMatchObject({
      ok: true,
    });
    await runInDurableObject(stub, (instance) => instance.testAgeLoadFailure(LOAD_RETRY_MIN_INTERVAL_MS));

    const client = await join(board);
    expect(texts(client.snapshot())).toEqual(['waiting to be read']);
    expect((await roomState(board)).loadAttempts).toBe(3);
    expect((await roomState(board)).state).toBe('ready');
  });
});

/* ---------------------------------------------------------------------------
 * TC-18: a room holding only its sockets
 * ------------------------------------------------------------------------- */

describe('a room that woke up with its sockets still open (persist.reload)', () => {
  it('TC-18: a wake rebuilds the board and reaches the sockets it kept (D1 snapshot+log/D4 hibernate)', async () => {
    const board = newBoardIdFor('tc18');
    const stub = roomStub(board);
    const a = await join(board);
    const b = await join(board);

    a.edit((doc) => {
      addSticky(doc, 10, 10, 'before the nap');
    });
    await b.waitForUpdates(1);

    // The document is gone while the sockets stay, which is the state a woken
    // object finds itself in.
    await runInDurableObject(stub, (instance) => {
      instance.testForgetDoc();
      return instance.testSocketCount();
    });
    expect((await roomState(board)).state).toBe('hibernated');
    expect((await storeStats(board)).updateRows).toBe(1);

    const before = b.updateCount();
    a.edit((doc) => {
      addSticky(doc, 20, 20, 'after the nap');
    });
    await b.waitForUpdates(before + 1);

    expect(texts(b.snapshot())).toEqual(['after the nap', 'before the nap']);
    expect(texts(await storedBoard(board))).toEqual(['after the nap', 'before the nap']);
    expect((await roomState(board)).state).toBe('ready');
  });
});
