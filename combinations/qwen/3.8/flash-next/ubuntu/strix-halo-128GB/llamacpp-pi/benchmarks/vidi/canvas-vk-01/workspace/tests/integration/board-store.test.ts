import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { runInDurableObject } from 'cloudflare:test';

import {
  BoardStore,
  type BoardStorage,
  type SqlValue,
  type LoadResult,
} from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  PERSIST_TESTED_NOTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { moveObject, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { bindings } from './helpers/bindings';
import {
  bulkyDoc,
  damagedUpdate,
  docsEqual,
  seededDoc,
  truncatedUpdate,
} from '../fixtures/boards';

/**
 * persist.board_store integration (TC-03..TC-11, TC-25): the BoardStore
 * contract against real Durable Object SQLite. Each test owns a board id, so
 * each owns a database, and every statement runs inside the object through
 * `runInDurableObject` — `ctx.storage.sql` is synchronous and only reachable
 * there.
 */

interface ExecCall {
  query: string;
  bindings: SqlValue[];
}

interface RoomContext {
  store: BoardStore;
  storage: BoardStorage;
  calls: ExecCall[];
}

/** Run `fn` against a migrated BoardStore over the board's own storage. */
async function withStore<T>(
  boardId: string,
  fn: (context: RoomContext) => T,
): Promise<T> {
  const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (_instance, state) => {
    const inner = state.storage as unknown as BoardStorage;
    const calls: ExecCall[] = [];
    const storage: BoardStorage = {
      transactionSync: (closure) => inner.transactionSync(closure),
      sql: {
        exec(query, ...bindings) {
          calls.push({ query, bindings });
          return inner.sql.exec(query, ...bindings);
        },
      },
    };
    const store = new BoardStore(storage);
    store.migrate();
    return fn({ store, storage, calls });
  });
}

/** Move existing notes around, each move being one update like a real drag. */
function moveNotes(doc: Y.Doc, times: number): void {
  const ids = snapshot(doc).map((note) => note.id);
  for (let move = 0; ids.length > 0 && move < times; move++) {
    moveObject(doc, ids[move % ids.length] as string, move, move * 2);
  }
}

/** A BLOB binding: workerd takes ArrayBuffer, not a Uint8Array view. */
function blob(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function rows(
  storage: BoardStorage,
  query: string,
  ...bindings: SqlValue[]
): Record<string, SqlValue>[] {
  return Array.from(storage.sql.exec(query, ...bindings).toArray()) as Record<string, SqlValue>[];
}

function countRows(storage: BoardStorage, table: string): number {
  const [row] = rows(storage, `SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n ?? -1);
}

/** Bookkeeping read straight out of `storage_meta`. */
function storageMeta(storage: BoardStorage, key: string): string | null {
  const found = rows(storage, 'SELECT value FROM storage_meta WHERE key = ?', key);
  return found.length === 0 ? null : String(found[0]?.value);
}

function maxSeq(storage: BoardStorage): number | null {
  const [row] = rows(storage, 'SELECT MAX(seq) AS seq FROM updates');
  return row?.seq === null || row?.seq === undefined ? null : Number(row.seq);
}

function chunkSizes(storage: BoardStorage): number[] {
  return rows(storage, 'SELECT length(data) AS n FROM snapshot_chunks ORDER BY idx').map((row) =>
    Number(row.n),
  );
}

describe('BoardStore on real Durable Object SQLite', () => {
  it('TC-03: migrate then load on an empty board leaves an empty doc and stamps the schema version', async () => {
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: snapshot(doc).length,
        tablesReadable:
          rows(storage, 'SELECT * FROM storage_meta').length >= 0 &&
          rows(storage, 'SELECT * FROM updates').length === 0 &&
          rows(storage, 'SELECT * FROM snapshot_chunks').length === 0 &&
          rows(storage, 'SELECT * FROM quarantined_updates').length === 0,
        version: storageMeta(storage, 'storage_schema_version'),
      };
    });
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toBe(0);
    expect(result.tablesReadable).toBe(true);
    expect(result.version).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-25: migrate on a board that was never edited writes no update or snapshot rows', async () => {
    const counts = await withStore(newBoardId(), ({ storage }) => ({
      updates: countRows(storage, 'updates'),
      chunks: countRows(storage, 'snapshot_chunks'),
      quarantined: countRows(storage, 'quarantined_updates'),
    }));
    expect(counts).toEqual({ updates: 0, chunks: 0, quarantined: 0 });
  });

  it('TC-04: append writes one row whose bytes column is the update length', async () => {
    const update = Y.encodeStateAsUpdate(seededDoc(1));
    const stored = await withStore(newBoardId(), ({ store, storage }) => {
      store.append(update);
      return { table: rows(storage, 'SELECT seq, bytes, length(data) AS length FROM updates') };
    });
    expect(stored.table).toHaveLength(1);
    // `bytes` is what compaction thresholds are counted from, `length(data)`
    // what SQLite actually stored — they must agree.
    expect(Number(stored.table[0]?.bytes)).toBe(update.byteLength);
    expect(Number(stored.table[0]?.length)).toBe(update.byteLength);
    expect(Number(stored.table[0]?.seq)).toBe(1);
  });

  it('TC-05: a log-only board loads into a fresh doc as the original snapshot', async () => {
    const loaded = await withStore(newBoardId(), ({ store, storage }) => {
      const source = seededDoc(25, (update) => store.append(update));
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        load,
        original: JSON.stringify(snapshot(source)),
        loaded: JSON.stringify(snapshot(fresh)),
        equal: docsEqual(source, fresh),
        rows: countRows(storage, 'updates'),
      };
    });

    expect(loaded.load).toEqual({ ok: true, quarantined: 0 });
    // One row per change: creating the document's schema is a change too.
    expect(loaded.rows).toBe(26);
    expect(loaded.loaded).toBe(loaded.original);
    expect(loaded.equal).toBe(true);
  });

  it('TC-06: compaction at COMPACTION_UPDATE_COUNT rows folds the log into the document', async () => {
    // One row per change, and stamping the document schema is a change.
    const rowsForSeed = 26;
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      const source = seededDoc(25, (update) => store.append(update));
      moveNotes(source, COMPACTION_UPDATE_COUNT - rowsForSeed);
      expect(countRows(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);

      const stateBefore = Y.encodeStateAsUpdate(source);
      const compacted = store.compactIfNeeded(source);
      const throughSeq = storageMeta(storage, 'snapshot_through_seq');

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        compacted,
        rows: countRows(storage, 'updates'),
        chunks: countRows(storage, 'snapshot_chunks'),
        throughSeq,
        maxSeq: maxSeq(storage),
        stateUntouched:
          Y.encodeStateAsUpdate(source).byteLength === stateBefore.byteLength,
        load,
        original: JSON.stringify(snapshot(source)),
        loaded: JSON.stringify(snapshot(fresh)),
        equal: docsEqual(source, fresh),
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.rows).toBe(0);
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.throughSeq).toBe(String(COMPACTION_UPDATE_COUNT));
    expect(result.maxSeq).toBeNull();
    expect(result.stateUntouched).toBe(true);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.loaded).toBe(result.original);
    expect(result.equal).toBe(true);
  });

  it('TC-07: after compaction only rows above snapshot_through_seq are replayed', async () => {
    const result = await withStore(newBoardId(), ({ store, storage, calls }) => {
      const source = seededDoc(25, (update) => store.append(update));
      store.compact(source);
      const throughSeq = Number(storageMeta(storage, 'snapshot_through_seq'));

      // Three changes made after the snapshot was taken.
      moveNotes(source, 3);

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        throughSeq,
        replayWindow: calls
          .filter((call) => call.query.includes('FROM updates WHERE seq > ?'))
          .map((call) => Array.from(call.bindings)),
        load,
        original: JSON.stringify(snapshot(source)),
        loaded: JSON.stringify(snapshot(fresh)),
        equal: docsEqual(source, fresh),
        logRows: countRows(storage, 'updates'),
      };
    });

    expect(result.logRows).toBe(3);
    // The replay window opens exactly at the sequence number the snapshot covers.
    expect(result.replayWindow).toEqual([[result.throughSeq]]);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.loaded).toBe(result.original);
    expect(result.equal).toBe(true);
  });

  it('TC-08: a board larger than SNAPSHOT_CHUNK_BYTES compacts into several chunks and reloads identically', async () => {
    const source = bulkyDoc(SNAPSHOT_CHUNK_BYTES + 64 * 1024);
    const encoded = Y.encodeStateAsUpdate(source).byteLength;
    expect(encoded).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    const result = await withStore(newBoardId(), ({ store, storage }) => {
      store.append(Y.encodeStateAsUpdate(source));
      const compacted = store.compact(source);
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        compacted,
        sizes: chunkSizes(storage),
        load,
        equal: docsEqual(source, fresh),
        notes: snapshot(fresh).length,
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.sizes.length).toBeGreaterThanOrEqual(2);
    expect(result.sizes.slice(0, -1).every((size) => size <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.equal).toBe(true);
    expect(result.notes).toBeGreaterThan(0);
  });

  it('TC-08b: a 6 MiB state compacts through compactIfNeeded into rows that each stay under the chunk limit', async () => {
    const sixMiB = 6 * 1024 * 1024;
    expect(sixMiB).toBeGreaterThanOrEqual(COMPACTION_BYTES);
    const source = bulkyDoc(sixMiB);

    const result = await withStore(newBoardId(), ({ store, storage }) => {
      store.append(Y.encodeStateAsUpdate(source));
      const compacted = store.compactIfNeeded(source);
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        compacted,
        sizes: chunkSizes(storage),
        load,
        equal: docsEqual(source, fresh),
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.sizes.length).toBeGreaterThan(Math.floor(sixMiB / SNAPSHOT_CHUNK_BYTES));
    expect(result.sizes.every((size) => size <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.equal).toBe(true);
  });

  it('TC-08c: a change bigger than the platform value limit is stored in rows and reassembled on load', async () => {
    // A bound value over ~2 MB is refused (SQLITE_TOOBIG), and pasting a big
    // board is one update that size, so the log has to split it.
    const source = bulkyDoc(COMPACTION_BYTES + 1024 * 1024);
    const update = Y.encodeStateAsUpdate(source);
    expect(update.byteLength).toBeGreaterThan(2 * 1024 * 1024);

    const result = await withStore(newBoardId(), ({ store, storage }) => {
      store.append(update);
      const sizes = rows(storage, 'SELECT length(data) AS n FROM updates ORDER BY seq').map((row) =>
        Number(row.n),
      );
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        sizes,
        logBytes: rows(storage, 'SELECT SUM(bytes) AS n FROM updates')[0]?.n,
        load,
        equal: docsEqual(source, fresh),
      };
    });

    expect(result.sizes.length).toBeGreaterThanOrEqual(2);
    expect(result.sizes.every((size) => size <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    expect(Number(result.logBytes)).toBe(update.byteLength);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.equal).toBe(true);
  });

  it('TC-09: a damaged log row is quarantined and the rest of the board loads', async () => {
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      const source = seededDoc(25, (update) => store.append(update));
      const before = countRows(storage, 'updates');
      const damaged = maxSeq(storage) as number;

      // Damage the newest change the way a half-written row looks.
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        blob(damagedUpdate()),
        64,
        damaged,
      );

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        before,
        damaged,
        load,
        after: countRows(storage, 'updates'),
        quarantine: rows(storage, 'SELECT seq, error FROM quarantined_updates'),
        notes: snapshot(fresh).length,
        total: snapshot(source).length,
      };
    });

    const load = result.load as LoadResult;
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.quarantined).toBe(1);
    expect(result.after).toBe(result.before - 1);
    expect(result.quarantine).toHaveLength(1);
    expect(Number(result.quarantine[0]?.seq)).toBe(result.damaged);
    expect(String(result.quarantine[0]?.error).length).toBeGreaterThan(0);
    // Only the damaged change is gone: 24 of the 25 notes are there.
    expect(result.total).toBe(25);
    expect(result.notes).toBe(24);
  });

  it('TC-09c: a quarantined change in the middle of the log is recovered when a client re-sends it', async () => {
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      const source = seededDoc(25, (update) => store.append(update));
      const damaged = 7;
      storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        blob(damagedUpdate()),
        64,
        damaged,
      );

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      const damagedLoad = snapshot(fresh).length;

      // Yjs chains later changes behind an earlier one it has not seen, so the
      // board comes back partly filled. The client that still holds the missing
      // change sends it in its SyncStep2, which is what re-syncing here stands
      // for: the board ends up complete again.
      Y.applyUpdate(fresh, Y.encodeStateAsUpdate(source));
      return {
        load,
        damagedLoad,
        equal: docsEqual(source, fresh),
        notes: snapshot(fresh).length,
        quarantined: countRows(storage, 'quarantined_updates'),
      };
    });

    const load = result.load as LoadResult;
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.quarantined).toBe(1);
    expect(result.damagedLoad).toBeLessThan(25);
    expect(result.quarantined).toBe(1);
    expect(result.notes).toBe(25);
    expect(result.equal).toBe(true);
  });

  it('TC-09b: a truncated update is quarantined rather than half-applied', async () => {
    const source = seededDoc(3);
    const update = Y.encodeStateAsUpdate(source);
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      store.append(truncatedUpdate(update));
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        load,
        updates: countRows(storage, 'updates'),
        quarantined: countRows(storage, 'quarantined_updates'),
      };
    });
    const load = result.load as LoadResult;
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.quarantined).toBe(1);
    expect(result.updates).toBe(0);
    expect(result.quarantined).toBe(1);
  });

  it('TC-10: a corrupted snapshot chunk reports unreadable and deletes nothing', async () => {
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      const source = seededDoc(25, (update) => store.append(update));
      store.compact(source);
      const chunksBefore = countRows(storage, 'snapshot_chunks');

      // Overwrite the first chunk's bytes, keeping the row and its length.
      const [first] = rows(storage, 'SELECT length(data) AS n FROM snapshot_chunks WHERE idx = 0');
      const length = Number(first?.n ?? 0);
      const garbage = damagedUpdate();
      const bytes = new Uint8Array(length);
      for (let offset = 0; offset < length; offset++) {
        bytes[offset] = garbage[offset % garbage.byteLength];
      }
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', blob(bytes));

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        load,
        chunks: countRows(storage, 'snapshot_chunks'),
        chunksBefore,
        log: countRows(storage, 'updates'),
        quarantined: countRows(storage, 'quarantined_updates'),
        notes: snapshot(fresh).length,
      };
    });

    const load = result.load as LoadResult;
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason).toBe('snapshot-unreadable');
    // Nothing was deleted, moved or quarantined; the room refuses to serve.
    expect(result.chunks).toBe(result.chunksBefore);
    expect(result.log).toBe(0);
    expect(result.quarantined).toBe(0);
    expect(result.notes).toBe(0);
  });

  it('TC-11: a write failure mid-compaction rolls the transaction back', async () => {
    const result = await withStore(newBoardId(), ({ store, storage }) => {
      const source = seededDoc(25, (update) => store.append(update));
      store.compact(source);
      const chunksBefore = countRows(storage, 'snapshot_chunks');
      const throughBefore = storageMeta(storage, 'snapshot_through_seq');

      // Two changes after the snapshot, then fail the statement that follows the
      // chunk delete inside the next compaction's transaction.
      moveNotes(source, 2);

      const proto = BoardStore.prototype as unknown as {
        writeSnapshotChunks(chunks: readonly Uint8Array[]): void;
      };
      const original = proto.writeSnapshotChunks;
      proto.writeSnapshotChunks = () => {
        throw new Error('injected compaction write failure');
      };
      let compacted = true;
      try {
        compacted = store.compact(source);
      } finally {
        proto.writeSnapshotChunks = original;
      }

      return {
        compacted,
        chunks: countRows(storage, 'snapshot_chunks'),
        chunksBefore,
        through: storageMeta(storage, 'snapshot_through_seq'),
        throughBefore,
        log: countRows(storage, 'updates'),
        equal: (() => {
          const fresh = new Y.Doc();
          const load = store.load(fresh);
          return load.ok === true && docsEqual(source, fresh);
        })(),
      };
    });

    expect(result.compacted).toBe(false);
    expect(result.chunks).toBe(result.chunksBefore);
    expect(result.through).toBe(result.throughBefore);
    // The two post-snapshot changes are still in the log, not lost.
    expect(result.log).toBe(2);
    expect(result.equal).toBe(true);
  });

  it('sanity: the load budget is quoted for PERSIST_TESTED_NOTES notes', () => {
    expect(PERSIST_TESTED_NOTES).toBe(2000);
  });
});
