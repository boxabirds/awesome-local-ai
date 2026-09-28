/**
 * Integration tests for BoardStore against real SQLite-backed Durable Object
 * storage: TC-03 to TC-11 and TC-25.
 *
 * Every assertion runs inside the room's own Durable Object via
 * `runInDurableObject`, so it sees the same SQLite database the room uses.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import { boardSnapshot, createTestBoard, undecodableBytes } from '../fixtures/boards';
import {
  BoardStore,
  type BoardStorageLike,
  type BoardStoreOptions,
  type SqlValue,
} from '../../src/worker/board-store';
import type { Env } from '../../src/worker';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

function stubFor(boardId: string): DurableObjectStub {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/**
 * Open a store over a room's storage, migrated. In production the room always
 * migrates before touching storage; a test opening its own store has to.
 */
function openStore(state: DurableObjectState, options?: BoardStoreOptions): BoardStore {
  const store = new BoardStore(state.storage, options);
  store.migrate();
  return store;
}

function rebuild(store: BoardStore): Y.Doc {
  const doc = new Y.Doc();
  store.load(doc);
  return doc;
}

/** Blob columns arrive as ArrayBuffer in workerd and Uint8Array in node. */
function blobLength(value: unknown): number {
  return value instanceof ArrayBuffer ? value.byteLength : (value as Uint8Array).length;
}

async function readSnapshotSizes(boardId: string): Promise<number[]> {
  return runInDurableObject(stubFor(boardId), (_instance, state) =>
    state.storage.sql
      .exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC')
      .toArray()
      .map((row) => blobLength(row.data)),
  );
}

describe('TC-03: an empty board migrates and loads empty', () => {
  it('creates the schema, records the version and writes no update rows', async () => {
    const id = newBoardId();
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      store.migrate(); // idempotent
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .toArray()
        .map((row) => row.name);
      return {
        tables,
        version: store.metaValue('storage_schema_version'),
        updateRows: store.updateRowCount(),
        snapshotRows: store.snapshotRowCount(),
      };
    });
    expect(result.tables.sort()).toEqual(
      ['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates'].sort(),
    );
    expect(result.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(result.updateRows).toBe(0);
    expect(result.snapshotRows).toBe(0);
  });

  it('loads nothing into a fresh doc', async () => {
    const id = newBoardId();
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      const doc = new Y.Doc();
      const loaded = store.load(doc);
      return { loaded, objects: boardSnapshot(doc).length, rows: store.updateRowCount() };
    });
    expect(result.loaded).toEqual({ ok: true, quarantined: 0 });
    expect(result.objects).toBe(0);
    expect(result.rows).toBe(0);
  });
});

describe('TC-04: append writes one row per update', () => {
  it('assigns ascending seq values and records the byte length', async () => {
    const id = newBoardId();
    const updates = [1, 2, 3, 4].map((seed) => Y.encodeStateAsUpdate(createTestBoard(2, seed)));
    await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      expect(store.updateRowCount()).toBe(0);
      for (const update of updates) store.append(update);
    });
    const rows = await runInDurableObject(stubFor(id), (_instance, state) =>
      state.storage.sql
        .exec<{ seq: number; size: number; bytes: number }>(
          'SELECT seq, LENGTH(data) AS size, bytes FROM updates ORDER BY seq',
        )
        .toArray(),
    );
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    expect(rows.every((row) => row.size > 0)).toBe(true);
    // The bytes column is what the compaction trigger adds up.
    expect(rows.map((row) => Number(row.bytes))).toEqual(updates.map((u) => u.byteLength));
  });
});

describe('TC-05: load reproduces the board', () => {
  it('round-trips a 40-note board through append + load', async () => {
    const id = newBoardId();
    const source = createTestBoard(40, 42);
    const update = Y.encodeStateAsUpdate(source);
    const expected = boardSnapshot(source);
    expect(expected.length).toBe(40);

    await runInDurableObject(stubFor(id), (_instance, state) => {
      openStore(state).append(update);
    });

    const loaded = await runInDurableObject(stubFor(id), (_instance, state) => {
      const doc = new Y.Doc();
      const result = openStore(state).load(doc);
      return { result, objects: boardSnapshot(doc) };
    });

    expect(loaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.objects).toEqual(expected);
  });
});

describe('TC-05: load after a restart', () => {  it('reads state written by a previous store instance', async () => {
    const id = newBoardId();
    const source = createTestBoard(12, 7);
    const expected = boardSnapshot(source);
    const update = Y.encodeStateAsUpdate(source);

    await runInDurableObject(stubFor(id), (_instance, state) => {
      openStore(state).append(update);
    });

    const second = await runInDurableObject(stubFor(id), (_instance, state) => {
      // A new BoardStore instance, as after the object was evicted and woken.
      const session = openStore(state);
      const doc = new Y.Doc();
      const result = session.load(doc);
      return { result, objects: boardSnapshot(doc), stats: session.stats };
    });

    expect(second.result).toEqual({ ok: true, quarantined: 0 });
    expect(second.objects).toEqual(expected);
    // Compaction state is read from SQL, not accumulated from zero.
    expect(second.stats.count).toBe(1);
    expect(second.stats.bytes).toBe(update.byteLength);
  });
});

describe('TC-06: compaction triggers at COMPACTION_UPDATE_COUNT rows', () => {
  it('folds the log at the threshold and records through_seq', async () => {
    const id = newBoardId();
    const updates: Uint8Array[] = [];
    for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
      updates.push(Y.encodeStateAsUpdate(createTestBoard(1, 500 + i)));
    }
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      const doc = new Y.Doc();
      for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
        store.append(updates[i]);
        Y.applyUpdate(doc, updates[i]);
      }
      const skipped = store.compactIfNeeded(doc);
      const rowsBeforeLast = store.updateRowCount();
      store.append(updates[COMPACTION_UPDATE_COUNT - 1]);
      Y.applyUpdate(doc, updates[COMPACTION_UPDATE_COUNT - 1]);
      const compacted = store.compactIfNeeded(doc);
      return {
        skipped,
        rowsBeforeLast,
        compacted,
        updateRows: store.updateRowCount(),
        snapshotRows: store.snapshotRowCount(),
        through: store.getSnapshotThroughSeq(),
        stats: store.stats,
        objects: boardSnapshot(doc).length,
      };
    });

    expect(result.skipped).toBe(false);
    expect(result.rowsBeforeLast).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(result.compacted).toBe(true);
    expect(result.updateRows).toBe(0);
    expect(result.snapshotRows).toBeGreaterThanOrEqual(1);
    // through_seq is the highest seq folded in.
    expect(result.through).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.stats).toEqual({ count: 0, bytes: 0 });

    // The board still loads completely after compaction.
    const loaded = await runInDurableObject(stubFor(id), (_instance, state) => {
      const doc = new Y.Doc();
      const load = openStore(state).load(doc);
      return { load, objects: boardSnapshot(doc).length };
    });
    expect(loaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.objects).toBe(COMPACTION_UPDATE_COUNT);
  });
});

describe('TC-07: a snapshot plus the log written after it loads correctly', () => {
  it('applies only rows with seq greater than snapshot_through_seq', async () => {
    const id = newBoardId();
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      const doc = new Y.Doc();

      const first = Y.encodeStateAsUpdate(createTestBoard(25, 701));
      store.append(first);
      Y.applyUpdate(doc, first);
      store.compact(doc);
      const through = store.getSnapshotThroughSeq();

      // Three updates on top of the snapshot.
      for (let i = 0; i < 3; i++) {
        const extra = Y.encodeStateAsUpdate(createTestBoard(3, 800 + i));
        store.append(extra);
        Y.applyUpdate(doc, extra);
      }

      const staleRows = state.storage.sql
        .exec('SELECT seq FROM updates WHERE seq <= ?', through)
        .toArray().length;
      const loaded = new Y.Doc();
      const load = store.load(loaded);
      return {
        through,
        staleRows,
        updateRows: store.updateRowCount(),
        snapshotRows: store.snapshotRowCount(),
        load,
        loaded: boardSnapshot(loaded),
        expected: boardSnapshot(doc),
      };
    });

    expect(result.through).toBeGreaterThan(0);
    expect(result.staleRows).toBe(0);
    expect(result.updateRows).toBe(3);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.loaded).toEqual(result.expected);
  });
});

describe('TC-06 boundary: compaction triggers at COMPACTION_BYTES', () => {
  it('folds the log on bytes while the row count is still low', async () => {
    const id = newBoardId();
    // The byte threshold is injected low: the configured 4 MB would need 4 MB
    // of writes to reach, and the trigger is the same comparison.
    const byteLimit = 8 * 1024;
    const boards = Array.from({ length: 40 }, (_v, i) => createTestBoard(4, 900 + i));
    const updates = boards.map((doc) => Y.encodeStateAsUpdate(doc));

    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state, { compactionBytes: byteLimit });
      const doc = new Y.Doc();
      let appended = 0;
      let statsWhenTriggered: { count: number; bytes: number } | null = null;
      for (const update of updates) {
        store.append(update);
        Y.applyUpdate(doc, update);
        appended++;
        if (store.stats.bytes >= byteLimit) {
          statsWhenTriggered = { ...store.stats };
          break;
        }
      }
      const compacted = store.compactIfNeeded(doc);
      return {
        appended,
        statsWhenTriggered,
        compacted,
        updateRows: store.updateRowCount(),
        snapshotRows: store.snapshotRowCount(),
        objects: boardSnapshot(rebuild(store)).length,
      };
    });

    expect(result.statsWhenTriggered).not.toBeNull();
    expect(result.appended).toBeLessThan(COMPACTION_UPDATE_COUNT);
    expect(result.compacted).toBe(true);
    expect(result.updateRows).toBe(0);
    expect(result.snapshotRows).toBeGreaterThanOrEqual(1);
    expect(result.objects).toBe(result.appended * 4);
  });

  it('does not compact below the configured byte threshold', async () => {
    const id = newBoardId();
    const board = createTestBoard(30, 3);
    const update = Y.encodeStateAsUpdate(board);
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      store.append(update);
      return {
        stats: store.stats,
        compacted: store.compactIfNeeded(board),
        updateRows: store.updateRowCount(),
      };
    });
    expect(update.byteLength).toBeLessThan(COMPACTION_BYTES);
    expect(result.stats).toEqual({ count: 1, bytes: update.byteLength });
    expect(result.compacted).toBe(false);
    expect(result.updateRows).toBe(1);
  });
});

describe('TC-08: chunked snapshot for a large board', () => {
  it('writes and reads a PERSIST_TESTED_NOTES board in chunks', async () => {
    const id = newBoardId();
    const source = createTestBoard(PERSIST_TESTED_NOTES, 77, 'all-long');
    const expected = boardSnapshot(source);
    const update = Y.encodeStateAsUpdate(source);
    expect(expected.length).toBe(PERSIST_TESTED_NOTES);

    // Chunk size injected small so a 2000-note board spans many rows; the
    // configured 512 KB default is asserted in the next test.
    const chunkBytes = 64 * 1024;
    const started = Date.now();
    const write = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state, {
        snapshotChunkBytes: chunkBytes,
        // A single update row cannot reach the configured row/byte thresholds,
        // so the trigger is lowered; chunking itself uses the injected size.
        compactionUpdateCount: 1,
      });
      store.append(update);
      const compacted = store.compactIfNeeded(rebuild(store));
      return { compacted, updateRows: store.updateRowCount() };
    });
    const sizes = await readSnapshotSizes(id);
    const writeMs = Date.now() - started;

    expect(write.compacted).toBe(true);
    expect(write.updateRows).toBe(0);
    expect(sizes.length).toBeGreaterThan(1);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(chunkBytes);

    const loadStarted = Date.now();
    const loaded = await runInDurableObject(stubFor(id), (_instance, state) => {
      const doc = new Y.Doc();
      const load = openStore(state).load(doc);
      return { load, objects: boardSnapshot(doc) };
    });
    const loadMs = Date.now() - loadStarted;

    expect(loaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.objects).toEqual(expected);
    console.log(
      `PERSIST_TESTED_NOTES=${PERSIST_TESTED_NOTES} updateBytes=${update.byteLength} ` +
        `snapshotRows=${sizes.length} writeMs=${writeMs} loadMs=${loadMs}`,
    );
  });

  it('never writes a snapshot row larger than SNAPSHOT_CHUNK_BYTES by default', async () => {
    const id = newBoardId();
    const source = createTestBoard(600, 5, 'all-long');
    const compacted = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state, { compactionUpdateCount: 1 });
      store.append(Y.encodeStateAsUpdate(source));
      return store.compactIfNeeded(rebuild(store));
    });
    expect(compacted).toBe(true);
    const sizes = await readSnapshotSizes(id);
    expect(sizes.length).toBeGreaterThanOrEqual(1);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
  });
});

describe('TC-09: a damaged update row is quarantined', () => {
  it('skips the damaged row, applies the rest and counts it', async () => {
    const id = newBoardId();
    const good = Y.encodeStateAsUpdate(createTestBoard(25, 61));
    // Ids are random per fixture, so the expected state is read back out of the
    // same update bytes that were stored.
    const source = new Y.Doc();
    Y.applyUpdate(source, good);
    const sourceSnapshot = boardSnapshot(source);
    const damaged = undecodableBytes(good.byteLength, 5);
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      store.append(good);
      store.append(damaged);
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        objects: boardSnapshot(doc),
        updateRows: store.updateRowCount(),
        quarantined: store.quarantinedRowCount(),
        stats: store.stats,
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 1 });
    expect(result.objects).toEqual(sourceSnapshot);
    // The damaged row left the log and landed in quarantine.
    expect(result.updateRows).toBe(1);
    expect(result.quarantined).toBe(1);
    // Quarantined bytes do not count towards the compaction trigger.
    expect(result.stats.count).toBe(1);
  });

  it('quarantines a truncated update too', async () => {
    const id = newBoardId();
    const good = Y.encodeStateAsUpdate(createTestBoard(6, 62));

    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      store.append(good);
      state.storage.sql.exec(
        'UPDATE updates SET data = ? WHERE seq = 1',
        good.slice(0, Math.floor(good.byteLength / 2)),
      );
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        quarantined: store.quarantinedRowCount(),
        objects: boardSnapshot(doc).length,
        updateRows: store.updateRowCount(),
      };
    });

    expect(result.load.ok).toBe(true);
    expect(result.quarantined).toBe(1);
    expect(result.objects).toBe(0);
    expect(result.updateRows).toBe(0);
  });
});

describe('TC-09 boundary: several damaged rows', () => {
  it('counts every damaged row and keeps serving the rest', async () => {
    const id = newBoardId();
    const goodA = Y.encodeStateAsUpdate(createTestBoard(3, 71));
    const goodB = Y.encodeStateAsUpdate(createTestBoard(3, 72));
    const combined = new Y.Doc();
    Y.applyUpdate(combined, goodA);
    Y.applyUpdate(combined, goodB);
    const expected = boardSnapshot(combined);
    expect(expected.length).toBe(6);

    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      store.append(goodA);
      store.append(undecodableBytes(96, 8));
      store.append(goodB);
      store.append(undecodableBytes(48, 9));
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        objects: boardSnapshot(doc),
        updateRows: store.updateRowCount(),
        quarantined: store.quarantinedRowCount(),
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 2 });
    expect(result.objects).toEqual(expected);
    expect(result.updateRows).toBe(2);
    expect(result.quarantined).toBe(2);
  });
});

describe('TC-10: a damaged snapshot fails the load', () => {
  it('reports snapshot-unreadable and neither deletes nor quarantines anything', async () => {
    const id = newBoardId();
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      const doc = createTestBoard(25, 1234);
      store.append(Y.encodeStateAsUpdate(doc));
      store.compact(doc);
      const before = {
        snapshotRows: store.snapshotRowCount(),
        updateRows: store.updateRowCount(),
        quarantined: store.quarantinedRowCount(),
      };

      // Chunk 0 no longer decodes.
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        undecodableBytes(64, 5),
      );

      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return {
        before,
        load,
        after: {
          snapshotRows: store.snapshotRowCount(),
          updateRows: store.updateRowCount(),
          quarantined: store.quarantinedRowCount(),
        },
        objects: boardSnapshot(fresh).length,
      };
    });

    expect(result.load.ok).toBe(false);
    if (!result.load.ok) {
      expect(result.load.reason).toBe('snapshot-unreadable');
    }
    // The board is left exactly as it was: nothing is destroyed by failing.
    expect(result.after).toEqual(result.before);
    expect(result.objects).toBe(0);
  });

  it('reports snapshot-unreadable when the chunk rows are missing', async () => {
    const id = newBoardId();
    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      const doc = createTestBoard(5, 1235);
      store.append(Y.encodeStateAsUpdate(doc));
      store.compact(doc);
      state.storage.sql.exec('DELETE FROM snapshot_chunks');
      const fresh = new Y.Doc();
      const load = store.load(fresh);
      return { load, objects: boardSnapshot(fresh).length };
    });
    expect(result.load.ok).toBe(false);
    if (!result.load.ok) expect(result.load.reason).toBe('snapshot-unreadable');
    expect(result.objects).toBe(0);
  });
});

describe('TC-11: a failed compaction rolls back', () => {
  it('keeps the previous snapshot and log when a statement throws', async () => {
    const id = newBoardId();
    const first = Y.encodeStateAsUpdate(createTestBoard(10, 81));
    const second = Y.encodeStateAsUpdate(createTestBoard(4, 82));

    const result = await runInDurableObject(stubFor(id), (_instance, state) => {
      const store = openStore(state);
      store.append(first);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, first);
      // Establish a snapshot to roll back to.
      store.compact(doc);
      store.append(second);
      Y.applyUpdate(doc, second);
      const expected = boardSnapshot(doc);

      const before = {
        snapshotRows: store.snapshotRowCount(),
        updateRows: store.updateRowCount(),
        through: store.getSnapshotThroughSeq(),
      };

      // Fail the snapshot INSERT inside the next compaction transaction.
      const realExec = state.storage.sql.exec.bind(state.storage.sql);
      const failingStorage: BoardStorageLike = {
        sql: {
          exec: (query: string, ...bindings: SqlValue[]) => {
            if (query.startsWith('INSERT INTO snapshot_chunks')) {
              throw new Error('injected snapshot write failure');
            }
            return realExec(query, ...bindings);
          },
        },
        transactionSync: <T,>(closure: () => T): T => state.storage.transactionSync(closure),
      };
      const wrapped = openStoreIn(state, failingStorage);
      wrapped.load(doc);
      // compactIfNeeded swallows the failure and reports false.
      const forced = wrapped.compactIfNeeded(doc);
      // compact() propagates it after the rollback.
      let threw = false;
      try {
        wrapped.compact(doc);
      } catch {
        threw = true;
      }

      return {
        forced,
        threw,
        before,
        after: {
          snapshotRows: store.snapshotRowCount(),
          updateRows: store.updateRowCount(),
          through: store.getSnapshotThroughSeq(),
        },
        objects: boardSnapshot(rebuild(store)),
        expected: expected as readonly StickySnapshot[],
      };
    });

    expect(result.forced).toBe(false);
    expect(result.threw).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(result.objects).toEqual(result.expected);
  });
});

/** A migrated store over a caller-supplied (possibly failing) storage wrapper. */
function openStoreIn(state: DurableObjectState, storage: BoardStorageLike): BoardStore {
  void state;
  const store = new BoardStore(storage, { compactionUpdateCount: 1 });
  store.migrate();
  return store;
}
