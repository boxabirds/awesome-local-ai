import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import {
  boardsEqual,
  encodeBoard,
  largeBoard,
  progressiveLog,
  randomBytesLike,
  seedNotes,
} from '../fixtures/boards';
import { roomStub, runInDurableObject, type RoomInternals } from './helpers/ws-client';

/**
 * Integration tests for `persist.board_store` (TC-03 to TC-11, TC-25) against
 * real Durable Object SQLite. Everything runs inside the object with `ctx.
 * storage.sql` being workerd's real SQLite; only the browser and the network
 * are absent. A store is built over the room's own storage — the same tables the
 * room writes — because the store's contract is the storage, not the room.
 *
 * Every test returns plain data that can cross the object boundary: counts, byte
 * lengths and snapshots, never a live `BoardStore` or `Y.Doc`.
 */

/** A `storage_meta` row. A type alias, not an interface: `SqlStorage.exec<T>`
 * requires `T extends Record<string, SqlStorageValue>`, and only an object type
 * alias gets the implicit index signature an interface does not. */
type MetaValue = { value: string };

/** Run `work` against a store over a fresh board's SQLite, return plain data. */
function inStore<T>(boardId: string, work: (store: BoardStore, sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(roomStub(boardId), (object) => {
    const storage = (object as unknown as RoomInternals).ctx.storage;
    const store = new BoardStore(storage);
    return work(store, storage.sql);
  });
}

/** Migrate and append every row, returning how many landed. */
function appendAll(store: BoardStore, rows: Uint8Array[]): number {
  store.migrate();
  for (const row of rows) store.append(row);
  return rows.length;
}

/** Read the stored schema version straight from the meta table. */
function schemaVersion(sql: SqlStorage): string | undefined {
  const rows = sql
    .exec<MetaValue>('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version')
    .toArray();
  return rows.length > 0 ? rows[0]!.value : undefined;
}

/** Load the store into a fresh document and report the result and its notes. */
function loadInto(store: BoardStore): {
  result: ReturnType<BoardStore['load']>;
  notes: readonly StickySnapshot[];
} {
  const fresh = new Y.Doc();
  const result = store.load(fresh);
  return { result, notes: snapshot(fresh) };
}

describe('TC-03, TC-25: an untouched board migrates to an empty, correct schema', () => {
  it('TC-03 migrate + load leaves the tables present and the document empty', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store, sql) => {
      store.migrate();
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        result,
        notes: snapshot(fresh).length,
        version: schemaVersion(sql),
        updates: store.countUpdates(),
        chunks: store.countChunks(),
      };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(0);
    expect(out.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(out.updates).toBe(0);
    expect(out.chunks).toBe(0);
  });

  it('TC-25 migrate writes no update rows and no snapshot chunks', async () => {
    const boardId = newBoardId();
    const counts = await inStore(boardId, (store) => {
      store.migrate();
      return { updates: store.countUpdates(), chunks: store.countChunks() };
    });
    expect(counts).toEqual({ updates: 0, chunks: 0 });
  });
});

describe('TC-04, TC-05: the log stores every update, byte-true', () => {
  it('TC-04 appending one update makes one row whose bytes column is its length', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store) => {
      const { rows } = progressiveLog(3, { seed: 11 });
      store.migrate();
      store.append(rows[0]!);
      return { rows: store.countUpdates(), bytes: store.updateBytes(1), length: rows[0]!.length };
    });
    expect(out.rows).toBe(1);
    expect(out.bytes).toBe(out.length);
  });

  it('TC-05 a 25-note board stored as a log loads into a fresh document identically', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store) => {
      const board = progressiveLog(25, { seed: 20260714, multiLine: true });
      appendAll(store, board.rows);
      const loaded = loadInto(store);
      return {
        result: loaded.result,
        notes: loaded.notes.length,
        equal: boardsEqual(board.notes, loaded.notes),
      };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(25);
    expect(out.equal).toBe(true);
  });
});

describe('TC-06, TC-07, TC-08: compaction folds the log without losing anything', () => {
  it('TC-06 at the count threshold the log folds to zero rows and a snapshot, reload identical', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store) => {
      const board = progressiveLog(COMPACTION_UPDATE_COUNT, { seed: 3 });
      appendAll(store, board.rows);
      const snapDoc = new Y.Doc();
      for (const row of board.rows) Y.applyUpdate(snapDoc, row);
      const folded = store.compactIfNeeded(snapDoc);
      const loaded = loadInto(store);
      return {
        folded,
        updates: store.countUpdates(),
        chunks: store.countChunks(),
        notes: loaded.notes.length,
        equal: boardsEqual(board.notes, loaded.notes),
      };
    });
    expect(out.folded).toBe(true);
    expect(out.updates).toBe(0); // the whole log folded into the snapshot
    expect(out.chunks).toBeGreaterThanOrEqual(1);
    expect(out.notes).toBe(COMPACTION_UPDATE_COUNT);
    expect(out.equal).toBe(true);
  });

  it('TC-07 updates written after a compaction are applied on load, and only those', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store) => {
      // one consistent 28-note board, folded after its first 25 notes
      const big = progressiveLog(28, { seed: 21 });
      appendAll(store, big.rows.slice(0, 25));
      // the snapshot doc is a replay of the stored rows, so it carries the very
      // clocks the later rows will extend — compaction is a fold, not a rewrite
      const snapDoc = new Y.Doc();
      for (const row of big.rows.slice(0, 25)) Y.applyUpdate(snapDoc, row);
      store.compactNow(snapDoc);
      const through = store.countUpdates();
      // three more changes land after the fold
      for (const row of big.rows.slice(25)) store.append(row);
      const loaded = loadInto(store);
      return {
        through,
        notes: loaded.notes.length,
        equal: boardsEqual(big.notes, loaded.notes),
      };
    });
    expect(out.through).toBe(0);
    expect(out.notes).toBe(28); // 25 before the fold + 3 after
    expect(out.equal).toBe(true);
  });

  it('TC-08 a large board folds into more than one chunk and reloads identical', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store) => {
      const doc = new Y.Doc();
      largeBoard(doc);
      const encoded = encodeBoard(doc);
      store.migrate();
      store.append(encoded);
      store.compactNow(doc);
      const loaded = loadInto(store);
      return {
        encodedBytes: encoded.length,
        chunks: store.countChunks(),
        notes: loaded.notes.length,
        equal: boardsEqual(snapshot(doc), loaded.notes),
      };
    });
    // The premise: the board really is bigger than one chunk, so a chunk count
    // above one is a real split, not an accident of a small document.
    expect(out.encodedBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(out.chunks).toBeGreaterThan(1);
    expect(out.notes).toBeGreaterThanOrEqual(1);
    expect(out.equal).toBe(true);
  });
});

describe('TC-09: a damaged log row is set aside, and the rest of the board loads', () => {
  it('overwrites row 7 with unreadable bytes: load is ok, one row quarantined, others present', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store, sql) => {
      const board = progressiveLog(12, { seed: 4242 });
      appendAll(store, board.rows);
      const healthy = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = 7').toArray();
      sql.exec('UPDATE updates SET data = ? WHERE seq = 7', randomBytesLike(new Uint8Array(healthy[0]!.data)));
      const loaded = loadInto(store);
      const present = loaded.notes.map((n) => n.id).sort();
      const original = board.notes.map((n) => n.id).sort();
      return {
        result: loaded.result,
        quarantinedRows: store.countQuarantined(),
        row7StillInLog: sql.exec('SELECT seq FROM updates WHERE seq = 7').toArray().length,
        row7Error: sql
          .exec<{ error: string }>('SELECT error FROM quarantined_updates WHERE seq = 7')
          .toArray()[0]?.error,
        kept: original.filter((id) => present.includes(id)).length,
        total: original.length,
      };
    });
    expect(out.result.ok).toBe(true); // the board opened despite the damage
    if (out.result.ok) expect(out.result.quarantined).toBe(1);
    expect(out.quarantinedRows).toBe(1);
    expect(out.row7StillInLog).toBe(0);
    expect(typeof out.row7Error).toBe('string');
    expect(out.row7Error!.length).toBeGreaterThan(0);
    // the later rows carry the whole board, so every note survives the one lost row
    expect(out.kept).toBe(out.total);
  });

  it('a truncated update in the log is quarantined rather than fatal', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store, sql) => {
      const board = progressiveLog(8, { seed: 77 });
      appendAll(store, board.rows);
      // damage a middle row (seq 3): the rows after it still carry its notes
      const middle = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = 3').toArray()[0]!;
      const damaged = new Uint8Array(middle.data).slice(0, 2);
      sql.exec('UPDATE updates SET data = ? WHERE seq = 3', damaged);
      const loaded = loadInto(store);
      return { result: loaded.result, quarantined: store.countQuarantined(), notes: loaded.notes.length };
    });
    expect(out.result.ok).toBe(true);
    expect(out.quarantined).toBeGreaterThanOrEqual(1);
    expect(out.notes).toBe(8); // the surviving rows still rebuild the whole board
  });
});

describe('TC-10: a snapshot that cannot be read is a load failure, not an empty board', () => {
  it('corrupting chunk 0 fails the load and deletes or quarantines nothing', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store, sql) => {
      const doc = new Y.Doc();
      seedNotes(doc, 20, { seed: 5150 });
      store.migrate();
      store.append(encodeBoard(doc));
      store.compactNow(doc);
      const chunksBefore = store.countChunks();
      const updatesBefore = store.countUpdates();
      const original = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray();
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesLike(new Uint8Array(original[0]!.data), 9));
      const loaded = loadInto(store);
      return {
        result: loaded.result,
        chunksAfter: store.countChunks(),
        updatesAfter: store.countUpdates(),
        chunksBefore,
        updatesBefore,
        quarantined: store.countQuarantined(),
        notesAfter: loaded.notes.length,
      };
    });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.reason).toBe('snapshot-unreadable');
    // nothing was deleted or quarantined to get there
    expect(out.chunksAfter).toBe(out.chunksBefore);
    expect(out.updatesAfter).toBe(out.updatesBefore);
    expect(out.quarantined).toBe(0);
    // and the room is not served a partially-loaded board
    expect(out.notesAfter).toBe(0);
  });
});

describe('TC-21: a board of the tested size loads within the board load budget', () => {
  // The budget is a worker-side promise: the time a room takes to read a whole
  // board out of its storage and hand it to a document. That is what is measured
  // here, at the storage layer, in the runtime the board actually loads in — not
  // a browser's cold page load, which no storage budget is about. A board of the
  // tested size is a compacted snapshot with a short log on top of it, which is
  // where a board that large really sits after it has been used.
  it('TC-21 reads a board of PERSIST_TESTED_NOTES notes back within the budget', async () => {
    const boardId = newBoardId();
    const out = await inStore(boardId, (store) => {
      // Build the tested-size board and store it the way a lived-in board is
      // stored: the notes go in, then the log folds into a snapshot.
      const board = new Y.Doc();
      largeBoard(board);
      store.migrate();
      store.append(encodeBoard(board));
      store.compactNow(board);

      // This — and only this — is the board load the budget is about.
      const started = Date.now();
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      const elapsedMs = Date.now() - started;

      return {
        result,
        notes: snapshot(fresh),
        elapsedMs,
        rowsLeft: store.countUpdates(),
      };
    });

    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes.length).toBe(PERSIST_TESTED_NOTES);
    // after one compaction the load replays a snapshot plus almost nothing
    expect(out.rowsLeft).toBeLessThan(COMPACTION_UPDATE_COUNT);
    expect(out.elapsedMs).toBeLessThan(BOARD_LOAD_BUDGET_MS);
    console.log(
      `TC-21 worker load: ${PERSIST_TESTED_NOTES} notes read from storage in ${out.elapsedMs}ms ` +
        `(budget ${BOARD_LOAD_BUDGET_MS}ms), ${out.rowsLeft} log row(s) after the snapshot`,
    );
  });
});

// --- helpers used inside the object boundary ---------------------------------

