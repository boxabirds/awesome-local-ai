/**
 * `BoardStore`, against a real Durable Object SQLite.
 *
 * These are storage tests, not room tests: no WebSocket is opened, and the store is
 * driven directly so that a failure points at a row, a chunk or a transaction rather
 * than at a client. Each test takes its own board id, which in a Durable Object means
 * its own database.
 *
 * The boards come from `tests/fixtures/boards.ts`, so the bytes below are the bytes
 * the app writes.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore, type LoadResult } from '../../src/worker/board-store';
import {
  editBoard,
  isRefusedByYjs,
  largeBoard,
  randomBytesLike,
  sharedRetroBoard,
  retroBoard,
  truncatedUpdate,
  unreadableBytes,
  type GeneratedBoard,
} from '../fixtures/boards';

/** The room's `ctx`, which is where its SQLite lives. */
interface RoomInternals {
  ctx: DurableObjectState;
}

/**
 * Run `work` with a store over the board's own storage. Only plain data may come back
 * out of the object, so `work` reports what it found instead of handing back the store.
 */
async function inStore<T>(
  boardId: string,
  work: (store: BoardStore, storage: DurableObjectStorage) => T,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room) => {
    const storage = (room as unknown as RoomInternals).ctx.storage;
    return work(new BoardStore(storage), storage);
  });
}

/** Write a generated board into storage the way the room would: update by update. */
async function seed(board: GeneratedBoard, boardId: string): Promise<number> {
  return inStore(boardId, (store, storage) => {
    store.migrate();
    for (const update of board.updates) store.append(update);
    return storage.sql.exec('SELECT COUNT(*) AS count FROM updates').one().count as number;
  });
}

function rows(storage: DurableObjectStorage, table: string): number {
  return storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`).one().count as number;
}

function throughSeq(storage: DurableObjectStorage): number {
  // `one()` throws when there is no row, and before the first compaction there is none.
  const row = storage.sql
    .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
    .toArray()[0] as { value: string } | undefined;
  return row === undefined ? 0 : Number.parseInt(row.value, 10);
}

function chunkSizes(storage: DurableObjectStorage): number[] {
  return (
    storage.sql
      .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
      .toArray() as { data: ArrayBuffer }[]
  ).map((row) => row.data.byteLength);
}

/** What the app would draw, as text, so a comparison reads as one line per note. */
function lines(notes: readonly StickySnapshot[]): string[] {
  return notes.map((note) => `${note.color} @ ${note.x},${note.y} | ${note.text}`);
}

/**
 * Apply every update of a board to a throwaway document: the reference result.
 *
 * It checks itself: an update that was never recorded leaves a gap in the document
 * clock that Yjs refuses to apply in silence, and a replay of that is an empty board
 * that every comparison happily agrees with.
 */
function replay(board: GeneratedBoard): string[] {
  const doc = new Y.Doc();
  for (const update of board.updates) Y.applyUpdate(doc, update);
  const result = lines(snapshot(doc));
  doc.destroy();
  expect(result.length).toBe(board.notes.length);
  return result;
}

/** The same, minus the update at `seq` — what a board reads back with one row quarantined. */
function replayExcept(board: GeneratedBoard, seq: number): string[] {
  const doc = new Y.Doc();
  for (const [index, update] of board.updates.entries()) {
    if (index + 1 === seq) continue;
    Y.applyUpdate(doc, update);
  }
  const result = lines(snapshot(doc));
  doc.destroy();
  expect(result.length).toBeGreaterThanOrEqual(board.notes.length - 1);
  return result;
}

describe('BoardStore.migrate (TC-03, TC-25)', () => {
  it('creates the four tables, an empty board and the storage version', async () => {
    const boardId = newBoardId();
    const outcome = await inStore(boardId, (store, storage) => {
      store.migrate();
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: snapshot(doc).length,
        mapKeys: doc.getMap('objects').size,
        tables: (
          storage.sql
            .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .toArray() as { name: string }[]
        ).map((row) => row.name),
        version: (
          storage.sql
            .exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'")
            .one() as { value: string }
        ).value,
        updateRows: rows(storage, 'updates'),
        chunkRows: rows(storage, 'snapshot_chunks'),
        quarantinedRows: rows(storage, 'quarantined_updates'),
      };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.notes).toBe(0);
    // Not even a stray empty entry in the shared map.
    expect(outcome.mapKeys).toBe(0);
    expect(outcome.tables).toEqual(
      expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']),
    );
    expect(outcome.version).toBe(String(STORAGE_SCHEMA_VERSION));
    // Opening a board writes nothing: no rows on read or on load (TC-25).
    expect(outcome.updateRows).toBe(0);
    expect(outcome.chunkRows).toBe(0);
    expect(outcome.quarantinedRows).toBe(0);
  });

  it('is safe to run twice', async () => {
    const boardId = newBoardId();
    const board = retroBoard();
    await seed(board, boardId);
    const second = await inStore(boardId, (store, storage) => {
      store.migrate();
      return rows(storage, 'updates');
    });
    expect(second).toBe(board.updates.length);
  });
});

describe('BoardStore.append (TC-04)', () => {
  it('writes one row holding the whole update and its size', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    await inStore(boardId, (store) => store.migrate());

    const first = board.updates[0];
    if (!first) throw new Error('the retro board produced no updates');
    const outcome = await inStore(boardId, (store, storage) => {
      store.append(first);
      const row = storage.sql.exec('SELECT seq, data, bytes FROM updates').one() as {
        seq: number;
        data: ArrayBuffer;
        bytes: number;
      };
      return { count: rows(storage, 'updates'), seq: row.seq, bytes: row.bytes, stored: new Uint8Array(row.data) };
    });

    expect(outcome.count).toBe(1);
    expect(outcome.seq).toBe(1);
    expect(outcome.bytes).toBe(first.byteLength);
    expect(Array.from(outcome.stored)).toEqual(Array.from(first));
  });
});

describe('BoardStore.load: log only (TC-05)', () => {
  it('rebuilds a 25-note board from the log alone', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    expect(board.notes.length).toBe(25);
    await seed(board, boardId);

    const outcome = await inStore(boardId, (store) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      const loaded = lines(snapshot(doc));
      doc.destroy();
      return { load, loaded };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.loaded.join('\n')).toBe(replay(board).join('\n'));
  });
});

describe('BoardStore compaction (TC-06, TC-07, TC-08)', () => {
  it('folds a full log into one snapshot and truncates the rows', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);

    // Top up to exactly the row threshold with real edits.
    const more = await inStore(boardId, (store) => {
      const needed = COMPACTION_UPDATE_COUNT - store.logStats().rows;
      const produced = editBoard(board, needed);
      for (const update of produced) store.append(update);
      return store.logStats();
    });
    expect(more.rows).toBe(COMPACTION_UPDATE_COUNT);

    const outcome = await inStore(boardId, (store, storage) => {
      const before = { updateRows: rows(storage, 'updates'), through: throughSeq(storage) };
      const compacted = store.compactIfNeeded(board.doc);
      return {
        before,
        compacted,
        updateRows: rows(storage, 'updates'),
        chunks: chunkSizes(storage).length,
        through: throughSeq(storage),
        log: store.logStats(),
      };
    });

    expect(outcome.compacted).toBe(true);
    expect(outcome.before.through).toBe(0);
    expect(outcome.updateRows).toBe(0);
    expect(outcome.chunks).toBeGreaterThanOrEqual(1);
    expect(outcome.through).toBe(COMPACTION_UPDATE_COUNT);
    expect(outcome.log).toEqual({ rows: 0, bytes: 0 });

    // And the folded board reads back as the board.
    const reloaded = await inStore(boardId, (store) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      const loaded = lines(snapshot(doc));
      doc.destroy();
      return { load, loaded };
    });
    expect(reloaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.loaded.join('\n')).toBe(replay(board).join('\n'));
  });

  it('applies only the rows written after the snapshot', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);
    await inStore(boardId, (store, storage) => {
      store.compactSnapshot(board.doc);
      return storage;
    });

    const after = await inStore(boardId, (store, storage) => {
      const through = throughSeq(storage);
      const three = editBoard(board, 3).slice(0, 3);
      for (const update of three) store.append(update);
      const seqs = (
        storage.sql.exec('SELECT seq FROM updates ORDER BY seq').toArray() as { seq: number }[]
      ).map((row) => row.seq);
      return { through, seqs };
    });
    expect(after.seqs.every((seq) => seq > after.through)).toBe(true);

    const reloaded = await inStore(boardId, (store) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      const loaded = lines(snapshot(doc));
      doc.destroy();
      return { load, loaded };
    });
    expect(reloaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.loaded.join('\n')).toBe(replay(board).join('\n'));
  });

  it('writes a 2000-note snapshot in the configured chunks and reloads it', async () => {
    const board = largeBoard();
    const boardId = newBoardId();
    expect(board.notes.length).toBeGreaterThanOrEqual(2000);
    await seed(board, boardId);

    const outcome = await inStore(boardId, (store, storage) => {
      const encoded = Y.encodeStateAsUpdate(board.doc);
      const compacted = store.compactIfNeeded(board.doc);
      return {
        encodedBytes: encoded.byteLength,
        compacted,
        chunks: chunkSizes(storage),
        updateRows: rows(storage, 'updates'),
      };
    });

    expect(outcome.compacted).toBe(true);
    expect(outcome.updateRows).toBe(0);
    expect(outcome.chunks.length).toBe(Math.ceil(outcome.encodedBytes / SNAPSHOT_CHUNK_BYTES));
    if (outcome.encodedBytes > SNAPSHOT_CHUNK_BYTES) {
      expect(outcome.chunks.length).toBeGreaterThan(1);
    }
    // Every chunk but the last is full, which is what makes the join exact.
    expect(outcome.chunks.slice(0, -1).every((size) => size === SNAPSHOT_CHUNK_BYTES)).toBe(true);

    const reloaded = await inStore(boardId, (store) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      const loaded = lines(snapshot(doc));
      doc.destroy();
      return { load, loaded };
    });
    expect(reloaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.loaded.length).toBe(board.notes.length);
    expect(reloaded.loaded.join('\n')).toBe(replay(board).join('\n'));
  }, 120_000);
});

describe('BoardStore quarantine (TC-09)', () => {
  /** Overwrite one log row with bytes Yjs refuses. */
  function damageRow(storage: DurableObjectStorage, seq: number, bytes: Uint8Array): void {
    storage.sql.exec(
      'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
      bytes.slice().buffer,
      bytes.byteLength,
      seq,
    );
  }

  function rowBytes(storage: DurableObjectStorage, seq: number): Uint8Array {
    const row = storage.sql.exec('SELECT data FROM updates WHERE seq = ?', seq).one() as {
      data: ArrayBuffer;
    };
    return new Uint8Array(row.data);
  }

  function logSize(storage: DurableObjectStorage): number {
    return storage.sql.exec('SELECT COUNT(*) AS count FROM updates').one().count as number;
  }

  function quarantinedRow(
    storage: DurableObjectStorage,
  ): { seq: number; error: string; bytes: Uint8Array } | null {
    const row = storage.sql
      .exec('SELECT seq, error, data FROM quarantined_updates')
      .toArray()[0] as { seq: number; error: string; data: ArrayBuffer } | undefined;
    return row === undefined ? null : { seq: row.seq, error: row.error, bytes: new Uint8Array(row.data) };
  }

  it('quarantines a damaged update and loads everything else', async () => {
    const board = sharedRetroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);

    const outcome = await inStore(boardId, (store, storage) => {
      const total = logSize(storage);
      // The last row of the log, so the board loses that update and nothing else.
      const target = total;
      const damaged = truncatedUpdate(rowBytes(storage, target));
      expect(isRefusedByYjs(damaged)).toBe(true);
      damageRow(storage, target, damaged);

      const doc = new Y.Doc();
      const load: LoadResult = store.load(doc);
      const loaded = lines(snapshot(doc));
      doc.destroy();
      return {
        target,
        load,
        loaded,
        updatesBefore: total,
        updatesAfter: rows(storage, 'updates'),
        kept: quarantinedRow(storage),
        damaged,
      };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 1 });
    // The row left the log and is kept, with its bytes and the reason, for whoever
    // has to repair the board later.
    expect(outcome.updatesAfter).toBe(outcome.updatesBefore - 1);
    expect(outcome.kept?.seq).toBe(outcome.target);
    expect((outcome.kept?.error ?? '').length).toBeGreaterThan(0);
    expect(Array.from(outcome.kept?.bytes ?? new Uint8Array())).toEqual(Array.from(outcome.damaged));

    // The rest of the board is the board: one update short, and nothing else.
    expect(outcome.loaded.join('\n')).toBe(replayExcept(board, outcome.target).join('\n'));
    expect(outcome.loaded.length).toBe(board.notes.length);
  });

  it('a hole in the middle costs one author later strokes, not the board', async () => {
    const board = sharedRetroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);

    const outcome = await inStore(boardId, (store, storage) => {
      const target = Math.floor(logSize(storage) / 2);
      const damaged = truncatedUpdate(rowBytes(storage, target));
      expect(isRefusedByYjs(damaged)).toBe(true);
      damageRow(storage, target, damaged);

      const doc = new Y.Doc();
      const load: LoadResult = store.load(doc);
      const loaded = snapshot(doc).map((note) => note.id);
      doc.destroy();
      return { target, load, loaded };
    });

    // A damaged row never turns the board away.
    expect(outcome.load).toEqual({ ok: true, quarantined: 1 });
    // Yjs has nowhere to put a hole in one document clock, so the updates that came
    // after it from the same author cannot be applied. The other author can, and did:
    // whoever was not damaged kept every note they wrote.
    const present = new Set(outcome.loaded);
    const firstComplete = board.firstClientNoteIds.every((id) => present.has(id));
    const secondComplete = board.secondClientNoteIds.every((id) => present.has(id));
    expect(firstComplete || secondComplete).toBe(true);
    expect(outcome.loaded.length).toBeLessThan(board.notes.length);
    // And nothing showed up that was never on the board.
    const expected = new Set(board.notes.map((note) => note.id));
    expect(outcome.loaded.every((id) => expected.has(id))).toBe(true);
  });

  it('quarantines random bytes too', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);

    const outcome = await inStore(boardId, (store, storage) => {
      const total = logSize(storage);
      const junk = randomBytesLike(rowBytes(storage, total));
      expect(isRefusedByYjs(junk)).toBe(true);
      damageRow(storage, total, junk);

      const doc = new Y.Doc();
      const load: LoadResult = store.load(doc);
      const notes = snapshot(doc).length;
      doc.destroy();
      return { load, notes, quarantined: rows(storage, 'quarantined_updates'), updates: rows(storage, 'updates'), total };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 1 });
    expect(outcome.quarantined).toBe(1);
    expect(outcome.updates).toBe(outcome.total - 1);
    // The board lost one update, not the board.
    expect(outcome.notes).toBe(25);
  });
});

describe('BoardStore snapshot damage (TC-10)', () => {
  it('reports an unreadable snapshot without deleting anything', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);

    await inStore(boardId, (store) => store.compactSnapshot(board.doc));

    // A few rows after the snapshot, so "the log is untouched" has something in it.
    const extra = await inStore(boardId, (store) => {
      const produced = editBoard(board, 3).slice(0, 3);
      for (const update of produced) store.append(update);
      return produced.length;
    });

    const outcome = await inStore(boardId, (store, storage) => {
      const before = {
        chunks: chunkSizes(storage).length,
        updates: rows(storage, 'updates'),
        through: throughSeq(storage),
      };
      const damaged = unreadableBytes(64);
      expect(isRefusedByYjs(damaged)).toBe(true);
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged.slice().buffer);

      const doc = new Y.Doc();
      const load: LoadResult = store.load(doc);
      const firstChunk = storage.sql
        .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
        .one() as { data: ArrayBuffer };
      return {
        before,
        damaged,
        load,
        chunksAfter: chunkSizes(storage).length,
        firstChunk: new Uint8Array(firstChunk.data),
        updatesAfter: rows(storage, 'updates'),
        throughAfter: throughSeq(storage),
        quarantined: rows(storage, 'quarantined_updates'),
        notes: snapshot(doc).length,
      };
    });

    expect(outcome.load).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    // Nothing is deleted or quarantined on a failed load: it can be retried, and the
    // bytes a repair needs are still where they were.
    expect(outcome.chunksAfter).toBe(outcome.before.chunks);
    expect(Array.from(outcome.firstChunk)).toEqual(Array.from(outcome.damaged));
    expect(outcome.updatesAfter).toBe(outcome.before.updates);
    expect(outcome.updatesAfter).toBe(extra);
    expect(outcome.throughAfter).toBe(outcome.before.through);
    expect(outcome.quarantined).toBe(0);
    expect(outcome.notes).toBe(0);
  });
});

describe('BoardStore compaction failure (TC-11)', () => {
  it('leaves the old snapshot and the whole log when a statement fails inside the transaction', async () => {
    const board = retroBoard();
    const boardId = newBoardId();
    await seed(board, boardId);
    // A snapshot to lose, and rows that must not be folded into it twice.
    await inStore(boardId, (store) => store.compactSnapshot(board.doc));
    const extra = await inStore(boardId, (store) => {
      const produced = editBoard(board, 3).slice(0, 3);
      for (const update of produced) store.append(update);
      return produced.length;
    });

    const outcome = await inStore(boardId, (_store, realStorage) => {
      const before = {
        chunks: chunkSizes(realStorage),
        updates: rows(realStorage, 'updates'),
        through: throughSeq(realStorage),
      };
      const storage = failOnNext(realStorage, 'INSERT INTO snapshot_chunks', 'DELETE FROM snapshot_chunks');
      const compacted = new BoardStore(storage).compactSnapshot(board.doc);
      return {
        before,
        compacted,
        chunks: chunkSizes(realStorage),
        updates: rows(realStorage, 'updates'),
        through: throughSeq(realStorage),
      };
    });

    expect(outcome.compacted).toBe(false);
    // The DELETE that ran before the failure is undone, and nothing new was written.
    expect(outcome.chunks).toEqual(outcome.before.chunks);
    expect(outcome.updates).toBe(outcome.before.updates);
    expect(outcome.updates).toBe(extra);
    expect(outcome.through).toBe(outcome.before.through);
  });
});

/**
 * A storage whose statement matching `statement` throws the first time it is seen
 * *after* `seenFirst` has run — which is how a compaction is made to die in the
 * middle, with the old snapshot already deleted.
 */
function failOnNext(
  storage: DurableObjectStorage,
  statement: string,
  seenFirst: string,
): DurableObjectStorage {
  let passedFirst = false;
  const sql = storage.sql;
  const guarded = {
    exec(query: string, ...bindings: unknown[]) {
      if (query.includes(seenFirst)) passedFirst = true;
      if (passedFirst && query.includes(statement)) {
        throw new Error(`injected failure in ${statement}`);
      }
      return sql.exec(query, ...(bindings as never[]));
    },
    get databaseSize(): number {
      return sql.databaseSize;
    },
  };
  return new Proxy(storage, {
    get(target, property) {
      if (property === 'sql') return guarded;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as CallableFunction).bind(target) : value;
    },
  }) as unknown as DurableObjectStorage;
}


