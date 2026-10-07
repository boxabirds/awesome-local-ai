import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import type { Env } from '../../src/worker/index';
import {
  buildUpdateLog,
  largeBoard,
  randomBytesLike,
  retroBoard,
  truncateUpdate,
} from '../fixtures/boards';
import { newBoardId } from '../../src/shared/board-id';

/**
 * persist.board_store, against real Durable Object SQLite (TC-03 to TC-11, TC-25).
 *
 * Storage behaviour — transactions rolling back, blobs round-tripping, ordering by
 * `seq`, a `transactionSync` that really rolls a failed compaction back — cannot be
 * faked in a plain unit test, so every case here runs inside a real Durable Object
 * (via `runInDurableObject`) on a private SQLite database isolated by board id. The
 * only thing mocked is a storage *failure*: a wrapper around the store's own
 * statement executor, which still runs SQLite, so rollback semantics stay real
 * (design "Mock vs real boundaries").
 */

const namespace = () => (env as unknown as Env).BOARD_ROOM;
const stubFor = (boardId: string) => namespace().get(namespace().idFromName(boardId));

/** Run `work` with a BoardStore over this board id's real SQLite storage. */
function withStore<T>(
  boardId: string,
  work: (store: BoardStore, sql: SqlStorage) => T,
): Promise<T> {
  return runInDurableObject(stubFor(boardId), (_room: BoardRoom, state: DurableObjectState) =>
    work(new BoardStore(state.storage), state.storage.sql),
  );
}

const freshDocWith = (updates: readonly Uint8Array[]): Y.Doc => {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
};

const countRows = (sql: SqlStorage, table: string): number =>
  sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`).one().c;

describe('a fresh board (TC-03, TC-25)', () => {
  it('TC-03: migrate + load creates the tables, an empty doc and version 1', async () => {
    const boardId = newBoardId();
    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: snapshot(doc).length,
        version: sql
          .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'")
          .one().value,
        tables: sql
          .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .toArray()
          .map((row) => row.name),
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toBe(0);
    expect(result.version).toBe(String(STORAGE_SCHEMA_VERSION));
    for (const table of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) {
      expect(result.tables).toContain(table);
    }
  });

  it('TC-25: opening a never-edited board writes no update or snapshot rows', async () => {
    const boardId = newBoardId();
    const counts = await withStore(boardId, (store, sql) => {
      store.migrate();
      store.load(new Y.Doc());
      return {
        updates: countRows(sql, 'updates'),
        chunks: countRows(sql, 'snapshot_chunks'),
        quarantined: countRows(sql, 'quarantined_updates'),
      };
    });
    expect(counts).toEqual({ updates: 0, chunks: 0, quarantined: 0 }); // only tables were created
  });
});

describe('appending to the log (TC-04)', () => {
  it('writes one row whose bytes column equals the update length', async () => {
    const boardId = newBoardId();
    const oneUpdate = [retroBoard().updates[1]!]; // a single sticky-creation update
    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      const before = countRows(sql, 'updates');
      store.append(oneUpdate[0]!);
      const row = sql.exec<{ bytes: number }>('SELECT bytes FROM updates ORDER BY seq DESC LIMIT 1').one();
      return { before, after: countRows(sql, 'updates'), bytes: row.bytes };
    });
    expect(result).toEqual({
      before: 0,
      after: 1,
      bytes: oneUpdate[0]!.byteLength,
    });
  });
});

describe('reloading the log (TC-05)', () => {
  it('reconstructs the exact board from log rows alone', async () => {
    const boardId = newBoardId();
    const built = retroBoard(); // 25 notes, one update each (plus the meta row)
    const result = await withStore(boardId, (store) => {
      store.migrate();
      for (const update of built.updates) store.append(update);
      const doc = new Y.Doc();
      const load = store.load(doc);
      return { load, reloaded: JSON.parse(JSON.stringify(snapshot(doc))) };
    });
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.reloaded).toEqual(JSON.parse(JSON.stringify(built.notes)));
  });
});

describe('compaction (TC-06, TC-07)', () => {
  it('TC-06: folds exactly COMPACTION_UPDATE_COUNT rows into one snapshot', async () => {
    const boardId = newBoardId();
    const built = buildUpdateLog(COMPACTION_UPDATE_COUNT);
    expect(built.updates).toHaveLength(COMPACTION_UPDATE_COUNT);

    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      for (const update of built.updates) store.append(update);
      const rowsBefore = countRows(sql, 'updates');
      const compactionDoc = freshDocWith(built.updates);
      const compacted = store.compactIfNeeded(compactionDoc);

      const through = sql
        .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .one().value;

      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        rowsBefore,
        compacted,
        rowsAfter: countRows(sql, 'updates'),
        chunks: countRows(sql, 'snapshot_chunks'),
        through,
        load,
        reloaded: JSON.parse(JSON.stringify(snapshot(doc))),
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.rowsBefore).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.rowsAfter).toBe(0); // the whole log became the snapshot
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.through).toBe(String(COMPACTION_UPDATE_COUNT)); // through_seq = max seq
    expect(result.load.ok).toBe(true);
    expect(result.reloaded).toEqual(JSON.parse(JSON.stringify(built.notes)));
  });

  it('TC-07: after compaction only rows past the snapshot are replayed', async () => {
    const boardId = newBoardId();
    const built = buildUpdateLog(COMPACTION_UPDATE_COUNT);
    const extra = buildUpdateLog(COMPACTION_UPDATE_COUNT + 3).updates.slice(COMPACTION_UPDATE_COUNT);

    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      const compactionDoc = freshDocWith(built.updates);
      for (const update of built.updates) store.append(update);
      store.compactIfNeeded(compactionDoc);

      // Three more changes arrive after the snapshot (the SnapshotPlusLog state).
      const liveDoc = new Y.Doc();
      for (const update of built.updates) Y.applyUpdate(liveDoc, update);
      for (const update of extra) {
        Y.applyUpdate(liveDoc, update);
        store.append(update);
      }

      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        logRows: countRows(sql, 'updates'),
        reloaded: JSON.parse(JSON.stringify(snapshot(doc))),
        expected: JSON.parse(JSON.stringify(snapshot(liveDoc))),
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.logRows).toBe(3); // only the post-snapshot rows remain in the log
    expect(result.reloaded).toEqual(result.expected);
  });
});

describe('a large board compacts into chunks (TC-08)', () => {
  it('TC-08: a PERSIST_TESTED_NOTES board yields multiple chunks and reloads identically', async () => {
    const boardId = newBoardId();
    const built = largeBoard(); // 2000 notes
    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      for (const update of built.updates) store.append(update);
      const compactionDoc = freshDocWith(built.updates);
      const encodedSize = Y.encodeStateAsUpdate(compactionDoc).byteLength;
      const compacted = store.compactIfNeeded(compactionDoc);
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        encodedSize,
        compacted,
        chunks: countRows(sql, 'snapshot_chunks'),
        logRows: countRows(sql, 'updates'),
        load,
        reloaded: snapshot(doc).length,
      };
    });

    expect(result.compacted).toBe(true);
    // Chunks scale with the encoded size; a big realistic board spans more than one.
    const expectedChunks = Math.ceil(result.encodedSize / SNAPSHOT_CHUNK_BYTES);
    expect(result.chunks).toBe(Math.max(1, expectedChunks));
    if (result.encodedSize > SNAPSHOT_CHUNK_BYTES) {
      expect(result.chunks).toBeGreaterThan(1);
    }
    expect(result.load.ok).toBe(true);
    expect(result.logRows).toBe(0);
    expect(result.reloaded).toBe(built.notes.length);
    console.log(`TC-08 large board: encoded ${result.encodedSize} bytes -> ${result.chunks} chunks`);
  }, 120_000);
});

describe('damage and rollback (TC-09, TC-10, TC-11)', () => {
  it('TC-09: one damaged log row is quarantined and the other 24 notes still load', async () => {
    const boardId = newBoardId();
    const built = retroBoard(); // seq 1 = meta, seq (1 + n) = note n
    const damagedSeq = 7; // note created 6th (index 5) — log row order is creation order
    const missingNoteId = built.createdIds[damagedSeq - 2]!; // seq 7 -> createdIds[5]

    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      for (const update of built.updates) store.append(update);
      // Corrupt one log row in place with a torn update.
      sql.exec('UPDATE updates SET data = ? WHERE seq = ?', toArrayBuffer(truncateUpdate(built.updates[damagedSeq - 1]!)), damagedSeq);
      const rowsBefore = countRows(sql, 'updates');

      const doc = new Y.Doc();
      const load = store.load(doc);
      const notes = snapshot(doc);
      const quarantined = sql
        .exec<{ seq: number; error: string }>('SELECT seq, error FROM quarantined_updates')
        .toArray();
      return {
        load,
        rowsBefore,
        rowsAfter: countRows(sql, 'updates'),
        noteCount: notes.length,
        missingPresent: notes.some((note) => note.id === missingNoteId),
        otherNotesIntact: notes.every((note) => note.color && typeof note.x === 'number'),
        quarantined,
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 1 });
    expect(result.rowsAfter).toBe(result.rowsBefore - 1); // the damaged row left the log
    expect(result.noteCount).toBe(built.notes.length - 1); // every other note survived
    expect(result.missingPresent).toBe(false); // exactly the damaged note is gone
    expect(result.otherNotesIntact).toBe(true);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]!.seq).toBe(damagedSeq);
    expect(result.quarantined[0]!.error.length).toBeGreaterThan(0); // error text was recorded
  });

  it('TC-10: a damaged snapshot is fatal and deletes or quarantines nothing', async () => {
    const boardId = newBoardId();
    const built = buildUpdateLog(COMPACTION_UPDATE_COUNT); // enough rows to compact

    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      for (const update of built.updates) store.append(update);
      store.compactIfNeeded(freshDocWith(built.updates));
      const chunksBefore = countRows(sql, 'snapshot_chunks');
      const updatesBefore = countRows(sql, 'updates');

      // Corrupt chunk 0 with random bytes of a plausible length.
      const chunk = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
      const damaged = randomBytesLike(new Uint8Array(chunk.data), 99);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', toArrayBuffer(damaged));

      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        chunksBefore,
        chunksAfter: countRows(sql, 'snapshot_chunks'),
        updatesAfter: countRows(sql, 'updates'),
        quarantined: countRows(sql, 'quarantined_updates'),
        updatesBefore,
      };
    });

    expect(result.load.ok).toBe(false);
    if (!result.load.ok) expect(result.load.reason).toBe('snapshot-unreadable');
    // Nothing was destroyed: the snapshot is untouched and the log never had rows.
    expect(result.chunksAfter).toBe(result.chunksBefore);
    expect(result.updatesAfter).toBe(result.updatesBefore);
    expect(result.quarantined).toBe(0);
  });

  it('TC-11: a failure mid-compaction rolls back, leaving snapshot and log intact', async () => {
    const boardId = newBoardId();
    const first = buildUpdateLog(COMPACTION_UPDATE_COUNT);
    const second = buildUpdateLog(COMPACTION_UPDATE_COUNT);

    const result = await withStore(boardId, (store, sql) => {
      store.migrate();
      const liveDoc = new Y.Doc();

      // A healthy first compaction, so there is a previous snapshot to protect.
      for (const update of first.updates) {
        store.append(update);
        Y.applyUpdate(liveDoc, update);
      }
      expect(store.compactIfNeeded(liveDoc)).toBe(true);
      const chunksBefore = countRows(sql, 'snapshot_chunks');
      expect(chunksBefore).toBeGreaterThanOrEqual(1);

      // A fresh log back over the threshold, waiting to be compacted again.
      for (const update of second.updates) {
        store.append(update);
        Y.applyUpdate(liveDoc, update);
      }
      const updatesBefore = countRows(sql, 'updates');
      expect(updatesBefore).toBe(COMPACTION_UPDATE_COUNT);

      // Wrap the store's own statement executor so the chunk-delete runs and then
      // throws inside transactionSync: SQLite really rolls the whole thing back.
      (store as unknown as { exec: unknown }).exec = (query: string, ...bindings: unknown[]) => {
        const cursor = sql.exec(query, ...bindings);
        if (query.startsWith('DELETE FROM snapshot_chunks')) throw new Error('injected compaction failure');
        return cursor;
      };
      const compacted = store.compactIfNeeded(liveDoc);

      return {
        compacted,
        chunksBefore,
        chunksAfter: countRows(sql, 'snapshot_chunks'),
        updatesBefore,
        updatesAfter: countRows(sql, 'updates'),
      };
    });

    expect(result.compacted).toBe(false);
    expect(result.chunksAfter).toBe(result.chunksBefore); // old snapshot survived
    expect(result.updatesAfter).toBe(result.updatesBefore); // and the log is intact
  });
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
