/**
 * A board's storage: written down, read back, damaged, and read back again.
 *
 * `BoardStore` is a plain class over `DurableObjectState#storage`, so testing it needs the one
 * thing a plain class cannot have for itself: a real SQLite storage belonging to a particular
 * board. Rather than add a test-only Durable Object to the deployment for the sake of a test,
 * these tests borrow one that exists anyway — a `BoardRoom` nobody connects to — and reach its
 * storage through `runInDurableObject`, which is the runtime's own way of running a statement
 * inside an object of the main worker. Every row here is in the storage of a real board.
 *
 * The damage is done to the rows rather than through the store's own API, because a test that
 * went through that API could only ever write bytes the store considers valid: a row whose
 * content was replaced by something the same length, a row with ten bytes missing from the end,
 * a row that is simply not there because its write never committed. That is what a storage that
 * has had a bad day looks like from the inside.
 *
 * The thresholds are the product's own. A compaction here is caused by the five hundred changes
 * the configuration says are enough, or by a board big enough to need more than one chunk —
 * never by a value a test invented to get there sooner.
 *
 *   TC-03  an empty board: the tables exist, a fresh document loads empty, and the storage
 *          records its own version
 *   TC-04  one change is one row, and the row says how big the change was
 *   TC-05  a board that is only a log comes back equal to the board that was written
 *   TC-06  at the threshold the log is folded: no log rows left, chunks, and the snapshot
 *          reaches as far as the last row it swallowed
 *   TC-07  changes made after a fold come back too, and only the rows past the snapshot
 *          are replayed
 *   TC-08  a board of PERSIST_TESTED_NOTES notes is written as several chunks and reads
 *          back complete
 *   TC-09  a damaged log row is set aside with its reason and counted; the board loads
 *   TC-10  a snapshot that cannot be read is `ok: false`, and nothing is deleted or set aside
 *   TC-11  a compaction that fails has not happened: previous snapshot and log intact
 *   TC-25  a board that was never edited has no update or snapshot rows in it
 */

import { env } from 'cloudflare:test';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as Y from 'yjs';

import { isStickySnapshot, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import {
  BoardStore,
  LOAD_ORIGIN,
  SCHEMA_VERSION_KEY,
  SNAPSHOT_THROUGH_SEQ_KEY,
  chunkBytes,
  joinChunks,
  shouldCompact,
  type FaultPoint,
  type LoadResult,
} from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import type { Env as WorkerEnv } from '../../src/worker/index';
import {
  comparable,
  largeBoard,
  phraseAt,
  recolourUpdates,
  retroBoard,
  cumulativeUpdates,
  scrambledUpdate,
  truncatedUpdate,
  type SeededBoard,
} from '../fixtures/boards';

/** The damage a test wants done to a row. */
type Damage =
  /** Same length, different content: the row is its usual size and is not a change. */
  | 'unreadable'
  /** The end of it is missing: a write that stopped on the way in. */
  | 'truncated';

/** What a read of a board came back as: the notes, and what it cost to get them. */
type Read = LoadResult & {
  notes: readonly StickySnapshot[];
  quarantined: number;
};

/**
 * The room namespace as it is deployed: every board here is in the storage of a real room
 * object, which is what `runInDurableObject` exists for.
 */
const rooms = (env as unknown as WorkerEnv).BOARD_ROOM;

/**
 * A handle on one board's room object. `DurableObjectStub` is not in the TypeScript 7 shape of
 * the worker types, so this is the handle the namespace actually hands back.
 */
type RoomStub = ReturnType<DurableObjectNamespace<BoardRoom>['get']>;

/** The store's own handle on the board's SQLite. */
type BoardSql = DurableObjectStorage['sql'];

/** Everything a test can say about one board's storage. */
class BoardStorage {
  private constructor(
    private readonly stub: RoomStub,
    /** The board as the thing that owns the store holds it — the room's own document. */
    readonly doc: Y.Doc,
  ) {}

  /**
   * Opens the storage of a board of this name — a board that exists, which since story 5 is
   * something that has to happen: the object is constructed by being asked to create itself,
   * which is the same call `POST /api/boards` makes and the only thing that makes tables.
   * The document is this harness's, standing in for the room's, and is what the store is
   * handed to fold.
   */
  static async open(name: string): Promise<BoardStorage> {
    const stub = rooms.get(rooms.idFromName(name));
    // Creating the board is the honest way to get to "a board with no changes on it": a plain
    // request to the object would now be answered with "this is a websocket endpoint" and
    // would leave the board's tables uncreated, because a request that reads creates nothing.
    await stub.initialize();
    return new BoardStorage(stub, new Y.Doc());
  }

  /** Runs a statement about this board's storage that the object itself answers. */
  initialize(): Promise<'created' | 'exists'> {
    return this.stub.initialize();
  }

  /** Runs a statement about this board's storage, inside the object that owns it. */
  private run<T>(statement: (store: BoardStore, sql: BoardSql) => T): Promise<T> {
    return runInDurableObject(this.stub, (room, state) =>
      statement(room.boardStore, state.storage.sql),
    );
  }

  /** A change arrives: the document gains it, the store keeps it. */
  append(update: Uint8Array): Promise<void> {
    Y.applyUpdate(this.doc, update);
    return this.run((store) => {
      store.append(update);
    });
  }

  /**
   * A change arrives and the log is folded if it has grown enough, which is the room's own
   * write path. Using it is what lets a test watch a fold happen in the middle of a board
   * being written rather than only after it.
   */
  use(update: Uint8Array): Promise<{ compacted: boolean }> {
    Y.applyUpdate(this.doc, update);
    return this.run((store) => {
      store.append(update);
      return { compacted: store.compactIfNeeded(this.doc) };
    });
  }

  /** The store keeps it and the document does not hear: a change the board was never told. */
  appendOnly(update: Uint8Array): Promise<void> {
    return this.run((store) => {
      store.append(update);
    });
  }

  /** Folds the log into a snapshot, if it has grown enough. */
  compact(): Promise<boolean> {
    return this.run((store) => store.compactIfNeeded(this.doc));
  }

  /** Reads the board into a document of the test's, leaving this one alone. */
  read(): Promise<Read> {
    return this.run((store) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        ...result,
        // Story 7 widened the model's `snapshot()` to every kind of object a board holds. What these
        // tests are holding the log for is notes, so the notes are what comes back out.
        notes: result.ok ? snapshot(fresh).filter(isStickySnapshot) : [],
        quarantined: result.ok ? result.quarantined : 0,
      };
    });
  }

  /** Reads the board into this harness's document: what a room rebuilt from storage does. */
  rebuild(): Promise<LoadResult> {
    return this.run((store) => {
      const loaded = new Y.Doc();
      const result = store.load(loaded);
      if (result.ok) this.adopt(loaded);
      return result;
    });
  }

  /** The board the harness is holding. */
  notes(): Promise<readonly StickySnapshot[]> {
    return Promise.resolve(snapshot(this.doc).filter(isStickySnapshot));
  }

  counts(): Promise<{
    updates: number;
    chunks: number;
    snapshotBytes: number;
    meta: number;
    quarantined: number;
    highestSeq: number;
    pendingRows: number;
    pendingBytes: number;
    throughSeq: number;
  }> {
    return this.run((store, sql) => {
      type CountRow = { n: number };
      const only = (query: string): number => {
        for (const row of sql.exec<CountRow>(query)) return row.n;
        throw new Error(`a statement answered nothing: ${query}`);
      };
      return {
        updates: only('SELECT COUNT(*) AS n FROM updates'),
        snapshotBytes: only('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM snapshot_chunks'),
        meta: only('SELECT COUNT(*) AS n FROM storage_meta'),
        quarantined: only('SELECT COUNT(*) AS n FROM quarantined_updates'),
        highestSeq: only('SELECT COALESCE(MAX(seq), 0) AS n FROM updates'),
        pendingRows: store.pendingRows,
        pendingBytes: store.pendingBytes,
        ...store.snapshotInfo(),
      };
    });
  }

  /** How much of this board is snapshot, and how much is still log. */
  snapshotInfo(): Promise<{ chunks: number; throughSeq: number }> {
    return this.run((store) => store.snapshotInfo());
  }

  /** The log rows still to be replayed, oldest first. */
  updateRows(): Promise<readonly { seq: number; bytes: number }[]> {
    return this.run((_store, sql) => {
      const rows: { seq: number; bytes: number }[] = [];
      for (const row of sql.exec<{ seq: number; bytes: number }>(
        'SELECT seq, bytes FROM updates ORDER BY seq',
      )) {
        rows.push({ seq: row.seq, bytes: row.bytes });
      }
      return rows;
    });
  }

  /** The changes that could not be read, and the reason each of them could not. */
  quarantinedRows(): Promise<readonly { seq: number; error: string; bytes: number }[]> {
    return this.run((_store, sql) => {
      const rows: { seq: number; error: string; bytes: number }[] = [];
      for (const row of sql.exec<{
        seq: number;
        error: string;
        data: ArrayBuffer;
      }>('SELECT seq, error, data FROM quarantined_updates ORDER BY seq')) {
        rows.push({
          seq: row.seq,
          error: row.error,
          bytes: new Uint8Array(row.data).length,
        });
      }
      return rows;
    });
  }

  /** One value out of the store's own record of this board. */
  metaValue(key: string): Promise<string | null> {
    return this.run((_store, sql) => {
      for (const row of sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        key,
      )) {
        return row.value;
      }
      return null;
    });
  }

  /**
   * Damages one log row: `unreadable` replaces its content with a different byte string of the
   * same length, `truncated` cuts the end off. Returns the length of what is there now.
   */
  damageUpdate(seq: number, damage: Damage): Promise<number> {
    return this.run((_store, sql) => {
      const bytes = readRow(sql, 'SELECT data FROM updates WHERE seq = ?', seq);
      const damaged = damage === 'truncated' ? truncatedUpdate(bytes) : scrambledUpdate(bytes);
      sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        asBlob(damaged),
        damaged.length,
        seq,
      );
      return damaged.length;
    });
  }

  /** Damages every chunk of the snapshot the same way, and says how many there were. */
  damageSnapshot(damage: Damage): Promise<number> {
    return this.run((_store, sql) => {
      const chunks = [
        ...sql.exec<{ idx: number; data: ArrayBuffer }>(
          'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
        ),
      ];
      for (const chunk of chunks) {
        const bytes = new Uint8Array(chunk.data);
        const damaged = damage === 'truncated' ? truncatedUpdate(bytes) : scrambledUpdate(bytes);
        sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', asBlob(damaged), chunk.idx);
      }
      return chunks.length;
    });
  }

  /** One log row's bytes, as the database holds them. */
  row(seq: number): Promise<Uint8Array | null> {
    return this.run((_store, sql) => {
      for (const found of sql.exec<{ data: ArrayBuffer }>(
        'SELECT data FROM updates WHERE seq = ?',
        seq,
      )) {
        return new Uint8Array(found.data);
      }
      return null;
    });
  }

  /** Removes a log row: a change whose write never committed, leaving a hole in the log. */
  deleteUpdate(seq: number): Promise<void> {
    return this.run((_store, sql) => {
      sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
  }

  /** Writes a row that is one byte repeated: a shape, not a change. */
  writeUnreadableRow(length = 64): Promise<number> {
    return this.run((_store, sql) => {
      const bytes = new Uint8Array(length).fill(0xff);
      sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', asBlob(bytes), bytes.length);
      for (const row of sql.exec<{ n: number }>('SELECT MAX(seq) AS n FROM updates')) return row.n;
      return 0;
    });
  }

  /** Makes the store's next statement at `point` fail, once. */
  failOnceAt(point: FaultPoint): Promise<void> {
    return this.run((store) => {
      const before = store.inject;
      let armed = true;
      store.inject = (seen: FaultPoint): void => {
        before(seen);
        if (armed && seen === point) {
          armed = false;
          throw new Error(`the storage said no to ${point}`);
        }
      };
    });
  }

  /**
   * Folds the log, and lets one more change in partway through: after the snapshot has been
   * encoded and the rows it replaces are deleted, before the fold is committed. That change is
   * what the fold has to leave alone.
   */
  foldWithLateChange(update: Uint8Array): Promise<boolean> {
    return this.run((store) => {
      const before = store.inject;
      let armed = true;
      store.inject = (point: FaultPoint): void => {
        before(point);
        if (armed && point === 'compact:after-chunk-delete') {
          armed = false;
          Y.applyUpdate(this.doc, update);
          store.append(update);
        }
      };
      return store.compactIfNeeded(this.doc);
    });
  }

  /** Stops failing. */
  clearFaults(): Promise<void> {
    return this.run((store) => {
      store.inject = () => {};
    });
  }

  /** Hands the harness's board over to a document that was just read from storage. */
  private adopt(loaded: Y.Doc): void {
    // The harness document is what the store is folded from, so a rebuild has to move into it
    // rather than be a second document the store knows nothing about.
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(loaded));
  }
}

/** A BLOB parameter wants an ArrayBuffer exactly as long as the bytes it is given. */
function asBlob(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/** One row's `data` column, as bytes. */
function readRow(sql: BoardSql, query: string, key: number): Uint8Array {
  for (const row of sql.exec<{ data: ArrayBuffer }>(query, key)) {
    return new Uint8Array(row.data);
  }
  throw new Error(`no row for ${String(key)}: ${query}`);
}

/**
 * A board's storage of one's own. The name is what makes it a different board: the Durable
 * Object behind it has its own SQLite file, and nothing any other test wrote is in it.
 */
function openStore(name: string): Promise<BoardStorage> {
  return BoardStorage.open(name);
}

/** Writes a whole board into a store. */
async function seed(store: BoardStorage, updates: readonly Uint8Array[]): Promise<void> {
  for (const update of updates) await store.append(update);
}

/** Writes a whole board, letting the store fold the log whenever it decides to. */
async function seedAsARoom(store: BoardStorage, updates: readonly Uint8Array[]): Promise<number> {
  let folds = 0;
  for (const update of updates) {
    if ((await store.use(update)).compacted) folds += 1;
  }
  return folds;
}

/** Enough rows to reach the product's own threshold for folding a log. */
async function fillToTheThreshold(store: BoardStorage, fixture: SeededBoard): Promise<number> {
  const rows = await store.counts();
  const needed = COMPACTION_UPDATE_COUNT - rows.pendingRows;
  for (let index = 0; index < needed; index++) {
    await store.appendOnly(fixture.updates[index % fixture.updates.length] as Uint8Array);
  }
  return needed;
}

/** A board as a test compares it: the notes, without the ids that belong to a document. */
const board = (notes: readonly StickySnapshot[]) => comparable(notes);

/**
 * Changes made to a board after it was written down, as a client would have sent them: one
 * update per transaction, in order. The fixture's own document gains them, which is the point —
 * a test asks for the board the document holds *now*, not the one it was built with.
 */
function laterChanges(fixture: SeededBoard, count: number): Uint8Array[] {
  return recolourUpdates(fixture, count);
}

/** The board a fixture holds at this moment. */
function currentBoard(fixture: SeededBoard): readonly Omit<StickySnapshot, 'id'>[] {
  return board(snapshot(fixture.doc).filter(isStickySnapshot));
}

describe('the board comes back as it was written down (TC-05)', () => {
  it('round-trips every byte of the log, in the order it arrived', async () => {
    const fixture = retroBoard();
    const store = await openStore('round-trip');
    expect(await store.counts()).toMatchObject({
      updates: 0,
      chunks: 0,
      quarantined: 0,
      highestSeq: 0,
    });

    const sequences: number[] = [];
    for (const update of fixture.updates) {
      await store.append(update);
      sequences.push((await store.counts()).highestSeq);
    }

    expect(sequences, 'the log numbers its rows from one, upward').toEqual(
      fixture.updates.map((_, index) => index + 1),
    );
    expect(await store.counts()).toMatchObject({
      updates: fixture.updates.length,
      pendingRows: fixture.updates.length,
    });

    const loaded = await store.read();
    expect(loaded).toMatchObject({ ok: true, quarantined: 0 });
    expect(board(loaded.notes)).toEqual(board(fixture.notes));
  });

  it('reads back a board that is half snapshot and half log (TC-07)', async () => {
    const fixture = retroBoard();
    const store = await openStore('snapshot-and-log');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    expect(await store.compact(), 'the log is folded').toBe(true);

    // A change made after the folding: it is in the log, and it is not in the snapshot.
    const changes = laterChanges(fixture, 3);
    for (const update of changes) await store.append(update);
    const expected = currentBoard(fixture);

    const counts = await store.counts();
    expect(counts).toMatchObject({ updates: changes.length, quarantined: 0 });
    expect(counts.throughSeq, 'the snapshot says how far it reaches').toBeGreaterThan(0);
    for (const row of await store.updateRows()) {
      expect(
        row.seq,
        'the log holds only changes the snapshot does not already contain',
      ).toBeGreaterThan(counts.throughSeq);
    }

    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(board(loaded.notes)).toEqual(expected);
  });

  it('is the same board however many times it is read back', async () => {
    const fixture = retroBoard();
    const store = await openStore('read-three-times');
    await seed(store, fixture.updates);
    const first = await store.read();
    const second = await store.read();
    const third = await store.read();
    expect(board(second.notes)).toEqual(board(first.notes));
    expect(board(third.notes)).toEqual(board(first.notes));
    expect(board(first.notes)).toEqual(board(fixture.notes));
    expect((await store.counts()).quarantined).toBe(0);
  });
});

describe('an empty board, and what the first change writes (TC-03, TC-25)', () => {
  it('writes nothing but the tables, and records the storage version (TC-03)', async () => {
    const store = await openStore('never-edited');
    expect(await store.counts()).toMatchObject({
      updates: 0,
      chunks: 0,
      quarantined: 0,
      highestSeq: 0,
      throughSeq: 0,
      pendingRows: 0,
      pendingBytes: 0,
    });
    expect(await store.metaValue(SCHEMA_VERSION_KEY)).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(await store.notes()).toEqual([]);

    const loaded = await store.read();
    expect(loaded).toMatchObject({ ok: true, quarantined: 0 });
    expect(loaded.notes).toEqual([]);
  });

  it("gets its schema version from the first change, which is the client's own", async () => {
    const fixture = retroBoard();
    const store = await openStore('first-change-writes-meta');
    const first = fixture.updates[0];
    if (!first) throw new Error('the fixture produced no updates');

    // The fixture's first update is the one `initDoc` made, which is where a real board's
    // `meta.schemaVersion` comes from: the client's own first change. Storage invents nothing.
    const meta = new Y.Doc();
    Y.applyUpdate(meta, first);
    expect(meta.getMap('meta').get('schemaVersion')).toBe(1);
    expect(snapshot(meta)).toEqual([]);

    await store.append(first);
    expect(await store.counts()).toMatchObject({ updates: 1 });
    expect(board((await store.read()).notes)).toEqual([]);
  });

  it("leaves the document's own meta alone when the board is folded away (TC-07)", async () => {
    const fixture = retroBoard();
    const store = await openStore('meta-through-compaction');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    expect(await store.compact()).toBe(true);
    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(board(loaded.notes)).toEqual(board(fixture.notes));
    expect(await store.metaValue(SCHEMA_VERSION_KEY)).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(await store.metaValue(SNAPSHOT_THROUGH_SEQ_KEY)).toBe(
      String((await store.snapshotInfo()).throughSeq),
    );
  });
});

describe('a change is one row, and a row can be missing (TC-04)', () => {
  it('writes one row per change, and says how big that change was (TC-04)', async () => {
    const fixture = retroBoard();
    const store = await openStore('one-row-per-change');
    const first = fixture.updates[0];
    const second = fixture.updates[1];
    if (!first || !second) throw new Error('the fixture has too few changes');

    await store.append(first);
    expect(await store.updateRows()).toEqual([{ seq: 1, bytes: first.length }]);
    expect(await store.row(1), 'the row holds the change, byte for byte').toEqual(first);

    await store.append(second);
    expect(await store.updateRows()).toEqual([
      { seq: 1, bytes: first.length },
      { seq: 2, bytes: second.length },
    ]);
    expect(await store.counts()).toMatchObject({
      updates: 2,
      pendingRows: 2,
      pendingBytes: first.length + second.length,
      highestSeq: 2,
      chunks: 0,
    });
  });

  it('loses that change and nothing else when it was the last one', async () => {
    // The shape this failure actually takes: the board was written up to a point, and the write
    // that would have carried the last change stopped on the way in.
    const fixture = retroBoard();
    const store = await openStore('hole-at-the-end');
    await seed(store, fixture.updates);
    const missing = (await store.counts()).highestSeq;
    await store.deleteUpdate(missing);

    const counts = await store.counts();
    expect(counts.updates).toBe(fixture.updates.length - 1);
    expect(counts.quarantined, 'a hole is not damage anyone can see, so nothing is set aside').toBe(
      0,
    );

    const loaded = await store.read();
    expect(loaded).toMatchObject({ ok: true, quarantined: 0 });
    expect(board(loaded.notes)).toEqual(board(fixture.notes.slice(0, -1)));
    const last = fixture.notes[fixture.notes.length - 1];
    if (!last) throw new Error('the fixture has no last note');
    expect(loaded.notes.map((note) => note.id)).not.toContain(last.id);
  });

  it('goes on being written to, and serves what the rows it has say', async () => {
    // What the store promises when a row is missing: the board is whatever the rows that are
    // there describe, applied in the order they arrived — and a row that arrives later is kept
    // like any other. What the surviving rows describe is not the whole board; it is never the
    // store's business to guess what the missing one carried.
    const fixture = retroBoard();
    const store = await openStore('changes-after-a-hole');
    await seed(store, fixture.updates);
    const rows = await store.updateRows();
    const missing = rows[rows.length - 1];
    if (!missing) throw new Error('the board has no rows');
    await store.deleteUpdate(missing.seq);

    const [change] = laterChanges(fixture, 1);
    if (!change) throw new Error('the fixture made no change');
    await store.append(change);

    const after = await store.updateRows();
    expect(after).toHaveLength(rows.length);
    expect(after[after.length - 1]?.seq, 'the log went on past the hole').toBeGreaterThan(
      missing.seq,
    );

    const loaded = await store.read();
    expect(loaded).toMatchObject({ ok: true, quarantined: 0 });
    const surviving = new Y.Doc();
    for (const row of after) {
      const update = await store.row(row.seq);
      if (update) Y.applyUpdate(surviving, update);
    }
    expect(board(loaded.notes)).toEqual(board(snapshot(surviving).filter(isStickySnapshot)));
    expect(loaded.notes.length).toBeLessThan(fixture.notes.length);
  });

  it('serves what it has when a row is missing from the middle, and says nothing about it', async () => {
    const fixture = retroBoard();
    const store = await openStore('hole-in-the-middle');
    await seed(store, fixture.updates);
    await store.deleteUpdate(7);

    const loaded = await store.read();
    expect(loaded.ok, 'a hole is not a reason to refuse the board').toBe(true);
    expect(loaded.quarantined, 'there is nothing to report, because nothing is unreadable').toBe(0);
    expect((await store.updateRows()).map((row) => row.seq)).not.toContain(7);

    const created = fixture.notes[6];
    if (!created) throw new Error('the fixture has no seventh note');
    expect(loaded.notes.map((note) => note.id)).not.toContain(created.id);
    expect(board(loaded.notes).length).toBeLessThan(fixture.notes.length);
  });

  it('loses nothing at all when the rows that survived already contain the board', async () => {
    // The other shape a log can have: each row the whole board as it was at that moment, which
    // is what `cumulativeUpdates` makes. A hole in one of those costs nothing, because the rows
    // after it carry what the missing one carried. This is the case a test should not have to
    // reason about twice, so it is written down next to the incremental one.
    const fixture = retroBoard();
    const store = await openStore('hole-in-a-cumulative-log');
    const rows = cumulativeUpdates(fixture);
    for (const update of rows) await store.append(update);
    await store.deleteUpdate((await store.updateRows())[0]?.seq as number);

    const loaded = await store.read();
    expect(loaded).toMatchObject({ ok: true, quarantined: 0 });
    expect(board(loaded.notes)).toEqual(board(fixture.notes));
  });
});

describe('damage in the log is one change, not the board (TC-09)', () => {
  it('sets aside the row it cannot read and loads the board anyway', async () => {
    const fixture = retroBoard();
    const store = await openStore('one-damaged-row');
    await seed(store, fixture.updates);
    const damagedLength = await store.damageUpdate(4, 'unreadable');

    const loaded = await store.read();
    expect(loaded.ok, 'the board is served').toBe(true);
    expect(loaded.quarantined).toBe(1);

    const records = await store.quarantinedRows();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ seq: 4, bytes: damagedLength });
    expect(records[0]?.error, "the record says why, in the reader's words").toMatch(/Error/);

    const expected = new Y.Doc();
    for (const [index, update] of fixture.updates.entries()) {
      if (index + 1 === 4) continue;
      Y.applyUpdate(expected, update);
    }
    expect(board(loaded.notes)).toEqual(board(snapshot(expected).filter(isStickySnapshot)));
  });

  /**
   * The reason a row is decoded before it is applied, on the record. Yjs integrates an update
   * struct by struct, so applying a row that fails half way through leaves part of itself in
   * the document — and the rows after it then treat those leftovers as structures they already
   * have, which is how one unreadable row would take most of the board with it.
   *
   * Written as self-contained rows (each one the whole board up to itself), the promise reads
   * the way the design states it: one damaged change, one damaged change.
   */
  it('decides about a row before it reaches the board (TC-09)', async () => {
    const fixture = retroBoard();
    const store = await openStore('row-decided-first');
    await seed(store, cumulativeUpdates(fixture));
    const damagedLength = await store.damageUpdate(4, 'unreadable');

    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined, 'one row could not be read').toBe(1);
    expect((await store.quarantinedRows())[0]?.bytes, 'and it is the one that was damaged').toBe(
      damagedLength,
    );
    expect(board(loaded.notes), 'nothing else was disturbed: the board is the board').toEqual(
      board(fixture.notes),
    );
  });

  it('sets aside a row that stopped arriving in the middle', async () => {
    const fixture = retroBoard();
    const store = await openStore('truncated-row');
    await seed(store, fixture.updates);
    const original = fixture.updates[1] as Uint8Array;
    const damagedLength = await store.damageUpdate(2, 'truncated');

    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(1);
    expect(damagedLength).toBeLessThan(original.length);
    const record = (await store.quarantinedRows())[0];
    expect(record?.bytes).toBe(damagedLength);
    expect(record?.error).toMatch(/end of array|Unexpected end/i);
  });

  it('does not set the same row aside twice for being read twice', async () => {
    const fixture = retroBoard();
    const store = await openStore('damage-read-twice');
    await seed(store, fixture.updates);
    await store.damageUpdate(5, 'unreadable');

    expect((await store.read()).ok).toBe(true);
    expect((await store.read()).ok).toBe(true);
    expect(await store.counts()).toMatchObject({
      quarantined: 1,
      updates: fixture.updates.length - 1,
    });
  });

  it('loads nothing and reports everything when the log is all damage', async () => {
    const fixture = retroBoard();
    const store = await openStore('all-rows-damaged');
    await seed(store, fixture.updates);
    for (const row of await store.updateRows()) await store.damageUpdate(row.seq, 'unreadable');

    const loaded = await store.read();
    expect(loaded.ok, 'a board of nothing is still served, and the damage is on the record').toBe(
      true,
    );
    expect(loaded.quarantined).toBe(fixture.updates.length);
    expect(loaded.notes).toEqual([]);
    expect((await store.counts()).updates, 'the damaged rows are out of the log').toBe(0);
  });

  it('keeps one record per damaged row, with the sequence of each (TC-09)', async () => {
    const fixture = retroBoard();
    const store = await openStore('three-damaged-rows');
    await seed(store, fixture.updates);
    const rows = await store.updateRows();
    const damaged = [rows[0]?.seq, rows[2]?.seq, rows[5]?.seq];
    for (const seq of damaged) {
      if (seq !== undefined) await store.damageUpdate(seq, 'unreadable');
    }

    const loaded = await store.read();
    expect(loaded.quarantined).toBe(3);
    expect((await store.quarantinedRows()).map((record) => record.seq)).toEqual(damaged);
    expect((await store.updateRows()).map((row) => row.seq)).toEqual(
      rows.map((row) => row.seq).filter((seq) => !damaged.includes(seq)),
    );
    expect(board(loaded.notes).length).toBeLessThan(fixture.notes.length);
  });

  it('reports a row of bytes that are not a change at all', async () => {
    const store = await openStore('row-of-nothing');
    await seed(store, retroBoard().updates);
    const seq = await store.writeUnreadableRow();
    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(1);
    const records = await store.quarantinedRows();
    expect(records[0]?.seq).toBe(seq);
  });
});

describe('a snapshot that cannot be read is never an empty board (TC-10)', () => {
  it('refuses to load, and leaves the rows alone', async () => {
    const fixture = retroBoard();
    const store = await openStore('damaged-snapshot');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    expect(await store.compact()).toBe(true);
    const before = await store.counts();
    expect(before.chunks).toBeGreaterThan(0);

    expect(await store.damageSnapshot('unreadable')).toBe(before.chunks);
    const loaded = await store.read();
    expect(loaded.ok, 'the board is not served').toBe(false);
    expect(loaded.ok ? '' : loaded.reason).toBe('snapshot-unreadable');
    expect(loaded.ok ? '' : loaded.error).toMatch(/Error/);

    expect(await store.counts()).toMatchObject({
      // Nothing was set aside and nothing was quietly truncated: the rows are where they were,
      // so the next attempt has the same chance the first one had.
      chunks: before.chunks,
      updates: before.updates,
      quarantined: 0,
      throughSeq: before.throughSeq,
    });
  });

  it('refuses to load a snapshot whose chunks no longer add up', async () => {
    const fixture = retroBoard();
    const store = await openStore('half-a-snapshot');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    expect(await store.compact()).toBe(true);
    expect(await store.damageSnapshot('truncated')).toBeGreaterThan(0);

    const loaded = await store.read();
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? '' : loaded.reason).toBe('snapshot-unreadable');
  });

  it('refuses to load when the database itself cannot be read', async () => {
    const store = await openStore('database-unreadable');
    await seed(store, retroBoard().updates);
    await store.failOnceAt('load:snapshot');

    const loaded = await store.read();
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? '' : loaded.reason).toBe('sql-error');
    expect(loaded.ok ? '' : loaded.error).toMatch(/the storage said no/);
    expect(
      (await store.counts()).quarantined,
      'a database that will not answer is not damage to report on',
    ).toBe(0);
  });

  it('refuses to load when it cannot read its own record', async () => {
    const store = await openStore('meta-unreadable');
    await seed(store, retroBoard().updates);
    await store.failOnceAt('load:meta');
    const loaded = await store.read();
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? '' : loaded.reason).toBe('sql-error');
  });

  it('serves what it has when there is no snapshot at all', async () => {
    // The other failure: no snapshot, which is what a board that has never been folded looks
    // like. That is not damage, and the board has to come back from the log alone.
    const fixture = retroBoard();
    const store = await openStore('log-only');
    await seed(store, fixture.updates);
    expect((await store.counts()).chunks).toBe(0);
    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(board(loaded.notes)).toEqual(board(fixture.notes));
  });
});

describe('a log that has grown is folded into a snapshot (TC-06, TC-08)', () => {
  it('writes a big board as more than one chunk, and reads all of it back', async () => {
    const fixture = largeBoard();
    const store = await openStore('big-board-compaction');
    const folds = await seedAsARoom(store, fixture.updates);

    const snapshotBytes = Y.encodeStateAsUpdate(fixture.doc).byteLength;
    expect(snapshotBytes, 'the fixture is the big board the story asks for').toBeGreaterThan(
      SNAPSHOT_CHUNK_BYTES,
    );
    const counts = await store.counts();
    expect(folds, 'the log was folded several times over').toBeGreaterThan(1);
    expect(
      counts.snapshotBytes,
      `the snapshot is most of a ${String(PERSIST_TESTED_NOTES)}-note board`,
    ).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(
      counts.chunks,
      'and it is more than one row, because no row is allowed to be that big',
    ).toBe(Math.ceil(counts.snapshotBytes / SNAPSHOT_CHUNK_BYTES));
    expect(counts.chunks).toBeGreaterThan(1);
    expect(counts.updates).toBeLessThan(COMPACTION_UPDATE_COUNT);
    expect(counts.quarantined, 'nothing was damaged on the way in').toBe(0);

    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(board(loaded.notes)).toEqual(board(fixture.notes));
    expect(loaded.notes).toHaveLength(PERSIST_TESTED_NOTES);
  });

  it('folds when the log reaches the number of changes the product says is enough (TC-06)', async () => {
    const fixture = retroBoard();
    const store = await openStore('fold-at-the-threshold');
    await seed(store, fixture.updates);
    const written = (await store.counts()).highestSeq;

    for (let index = 0; index < COMPACTION_UPDATE_COUNT - fixture.updates.length - 1; index++) {
      await store.appendOnly(fixture.updates[index % fixture.updates.length] as Uint8Array);
      expect((await store.counts()).chunks, 'nothing is folded before the threshold').toBe(0);
    }
    expect(await store.compact(), 'still one short').toBe(false);
    await store.appendOnly(fixture.updates[0] as Uint8Array);
    expect(await store.compact(), 'the threshold, and it folds').toBe(true);

    const counts = await store.counts();
    expect(counts.updates).toBe(0);
    expect(counts.chunks).toBeGreaterThan(0);
    expect(counts.throughSeq).toBe(written + COMPACTION_UPDATE_COUNT - fixture.updates.length);
  });

  it('reads the same board from the snapshot as it did from the log', async () => {
    const fixture = largeBoard(600);
    const store = await openStore('log-or-snapshot');
    await seed(store, fixture.updates);
    const fromTheLog = await store.read();
    expect(await store.compact()).toBe(true);
    const fromTheSnapshot = await store.read();
    expect(board(fromTheSnapshot.notes)).toEqual(board(fromTheLog.notes));
    expect(board(fromTheLog.notes)).toEqual(board(fixture.notes));
    expect(fromTheSnapshot.quarantined).toBe(0);
  });

  it('keeps the counters honest about what is still in the log (TC-06)', async () => {
    const fixture = retroBoard();
    const store = await openStore('counters');
    await seed(store, fixture.updates);
    const written = fixture.updates.reduce((total, update) => total + update.length, 0);
    expect(await store.counts()).toMatchObject({
      pendingRows: fixture.updates.length,
      pendingBytes: written,
    });

    await fillToTheThreshold(store, fixture);
    expect(await store.compact(), 'folded').toBe(true);
    expect(await store.counts()).toMatchObject({
      pendingRows: 0,
      pendingBytes: 0,
      updates: 0,
      throughSeq: expect.any(Number) as number,
    });

    // Reading the board back puts the counters where the rows are, which is what lets the next
    // fold decision be made without asking the database.
    expect((await store.rebuild()).ok).toBe(true);
    expect((await store.counts()).pendingRows).toBe(0);
    const next = fixture.updates[0] as Uint8Array;
    await store.append(next);
    expect(await store.counts()).toMatchObject({
      pendingRows: 1,
      pendingBytes: next.length,
    });
  });

  it('keeps a change that arrives while the log is being folded (TC-11)', async () => {
    const fixture = retroBoard();
    const store = await openStore('change-during-fold');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    const beforeFold = await store.counts();

    // The change a person makes while the fold is running lands in a row past the last one the
    // fold knows about, so the fold leaves it alone. That is what `seq <= maxSeq` is for.
    const [late] = laterChanges(fixture, 1);
    if (!late) throw new Error('the fixture made no late change');
    const expected = currentBoard(fixture);
    expect(await store.foldWithLateChange(late), 'the fold goes ahead').toBe(true);

    const counts = await store.counts();
    expect(counts.quarantined).toBe(0);
    expect(counts.throughSeq, 'the snapshot stops short of the change made during it').toBe(
      beforeFold.highestSeq,
    );

    const loaded = await store.read();
    expect(loaded.ok).toBe(true);
    expect(board(loaded.notes)).toEqual(expected);
  });

  it('folds nothing when there is nothing to fold', async () => {
    const store = await openStore('nothing-to-fold');
    expect(await store.compact(), 'an empty log is not worth a snapshot').toBe(false);
    await seed(store, retroBoard().updates);
    expect(await store.compact(), 'and a short one is not either').toBe(false);
  });
});

describe('a compaction that fails has not happened (TC-11)', () => {
  it('leaves the previous snapshot and the whole log where they were', async () => {
    const fixture = retroBoard();
    const store = await openStore('compaction-rolled-back');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    expect(await store.compact(), 'a first fold, so that there is a snapshot to keep').toBe(true);
    const snapshotBefore = await store.counts();

    await fillToTheThreshold(store, fixture);
    const logBefore = await store.counts();

    // Fail inside the fold, after the old snapshot has been deleted and before the new rows are
    // in: the statement fails, the transaction is rolled back, and neither the old snapshot nor
    // any log row has been touched.
    await store.failOnceAt('compact:after-chunk-delete');
    expect(await store.compact()).toBe(false);

    const after = await store.counts();
    expect(after).toMatchObject({
      chunks: snapshotBefore.chunks,
      snapshotBytes: snapshotBefore.snapshotBytes,
      updates: logBefore.updates,
      throughSeq: snapshotBefore.throughSeq,
      pendingRows: logBefore.pendingRows,
      pendingBytes: logBefore.pendingBytes,
      quarantined: 0,
    });
    expect(board((await store.read()).notes)).toEqual(board(fixture.notes));
  });

  it('tries again with the next change, and folds then', async () => {
    const fixture = retroBoard();
    const store = await openStore('compaction-retried');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    await store.failOnceAt('compact:encode');
    expect(await store.compact(), 'the encoding failed, so nothing was folded').toBe(false);
    expect((await store.counts()).updates).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);

    await store.clearFaults();
    expect(await store.compact(), 'the next change gives it another go').toBe(true);
    expect(await store.counts()).toMatchObject({
      updates: 0,
      pendingRows: 0,
      pendingBytes: 0,
    });
    expect(board((await store.read()).notes)).toEqual(board(fixture.notes));
  });

  it('keeps the record of damage it already had', async () => {
    const fixture = retroBoard();
    const store = await openStore('damage-record-survives');
    await seed(store, fixture.updates);
    await store.damageUpdate(1, 'unreadable');
    expect((await store.read()).ok).toBe(true);
    const records = await store.quarantinedRows();
    expect(records).toHaveLength(1);

    await fillToTheThreshold(store, fixture);
    await store.failOnceAt('compact:after-log-delete');
    expect(await store.compact()).toBe(false);
    expect(await store.quarantinedRows()).toEqual(records);
    expect(board((await store.read()).notes)).toEqual(board(fixture.notes));
  });

  it('does not leave a half-written snapshot behind for the next board to find', async () => {
    const fixture = retroBoard();
    const store = await openStore('no-half-snapshot');
    await seed(store, fixture.updates);
    await fillToTheThreshold(store, fixture);
    expect(await store.compact()).toBe(true);
    const chunks = (await store.counts()).chunks;

    await store.failOnceAt('compact:after-log-delete');
    expect(await store.compact()).toBe(false);
    // The rows that make a snapshot are all of it or none of it: a board read from a snapshot
    // that was part old and part new would be a board nobody wrote.
    expect((await store.counts()).chunks).toBe(chunks);
    expect((await store.read()).ok).toBe(true);
  });
});

describe('what the store hands to a caller', () => {
  it('exports the helpers it needs, typed the way they behave', () => {
    expectTypeOf(chunkBytes).parameter(1).toEqualTypeOf<number | undefined>();
    expectTypeOf(chunkBytes).returns.toEqualTypeOf<Uint8Array[]>();
    expectTypeOf(joinChunks).parameters.toEqualTypeOf<[readonly Uint8Array[]]>();
    expectTypeOf(joinChunks).returns.toEqualTypeOf<Uint8Array>();
    expectTypeOf(shouldCompact).parameter(0).toEqualTypeOf<number | undefined>();
    expectTypeOf<LoadResult>().toMatchTypeOf<{ ok: boolean }>();
    expectTypeOf<BoardStore['append']>().parameters.toEqualTypeOf<[update: Uint8Array]>();
    expectTypeOf<BoardStore['load']>().parameters.toEqualTypeOf<[doc: Y.Doc]>();
    expect(typeof LOAD_ORIGIN, 'the origin is a symbol, so no message can carry it').toBe('symbol');
  });

  it('gives back the bytes it was given, split and rejoined', () => {
    const data = new Uint8Array(1_000);
    for (let index = 0; index < data.length; index++) data[index] = (index * 7) % 256;
    expect(joinChunks(chunkBytes(data, 400))).toEqual(data);
    expect(joinChunks(chunkBytes(data))).toEqual(data);
  });

  it('tells the caller how far the snapshot reaches', async () => {
    const fixture = retroBoard();
    const store = await openStore('snapshot-info');
    await seed(store, fixture.updates);
    expect(await store.snapshotInfo()).toEqual({ chunks: 0, throughSeq: 0 });
    await fillToTheThreshold(store, fixture);
    expect(await store.compact()).toBe(true);
    const info = await store.snapshotInfo();
    expect(info.chunks).toBeGreaterThan(0);
    expect(info.throughSeq).toBe((await store.counts()).throughSeq);
    expect(info.throughSeq).toBeGreaterThan(0);
  });

  it('writes down a sentence and reads the same sentence back', async () => {
    // The small, boring version of the whole story: one sentence, written and read.
    const fixture = retroBoard();
    const store = await openStore('one-sentence');
    await seed(store, fixture.updates);
    const note = fixture.notes[0];
    const [update] = laterChanges(fixture, 1);
    if (!update || !note) throw new Error('the fixture has nothing to change');
    await store.append(update);

    const loaded = await store.read();
    const read = loaded.notes.find((candidate) => candidate.id === note.id);
    expect(read?.color, 'the change was a recolouring, and it came back').not.toBe(note.color);
    expect(read?.text).toContain(phraseAt(0).slice(0, 20));
  });
});
