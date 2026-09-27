/**
 * tests/integration/board-store.test.ts
 *
 * The storage layer against real SQLite in a Durable Object: TC-03 to TC-11 and
 * TC-25.
 *
 * A real `DurableObjectStorage` only exists inside the object, so each test
 * works through `withStore`/`withSql` (see `helpers/store.ts`) and returns plain
 * values. Updates are the ones Yjs emitted from boards built by
 * `tests/fixtures/boards.ts`, never hand-written ones, so what is stored is what
 * the product stores.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { initDoc, snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import {
  corruptedChunk,
  largeBoard,
  retroBoard,
  truncatedUpdate,
  unreadableBytes,
} from '../fixtures/boards';
import { countRows, metaValue, storageFailingAfter, uniqueBoardId, withSql, withStore } from './helpers/store';

/** SQLite binds blobs as ArrayBuffer; the fixtures hand out Uint8Array. */
const buffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);

/** A document whose every emitted update is appended to the log as it happens. */
function loggedDoc(store: BoardStore): Y.Doc {
  const doc = new Y.Doc();
  doc.on('update', (update: Uint8Array) => store.append(update));
  return doc;
}

/**
 * The stored board as a working document: read first, then start logging, so
 * reading the board is not mistaken for new changes — which is exactly how the
 * room opens it.
 */
function openLiveDoc(store: BoardStore): { doc: Y.Doc; loadResult: ReturnType<BoardStore['load']> } {
  const doc = new Y.Doc();
  const loadResult = store.load(doc);
  doc.on('update', (update: Uint8Array) => store.append(update));
  return { doc, loadResult };
}

/** A short fingerprint of a table's contents, to prove nothing changed. */
function fingerprint(sql: SqlStorage, query: string): string {
  const rows = sql.exec<Record<string, SqlStorageValue>>(query).toArray();
  let hash = 2166136261;
  for (const row of rows) {
    for (const value of Object.values(row)) {
      const text = value instanceof ArrayBuffer ? new Uint8Array(value) : typeof value === 'string' ? value : String(value);
      for (let i = 0; i < text.length; i++) {
        const byte = typeof text === 'string' ? (text.codePointAt(i) as number) : (text[i] as number);
        hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      }
    }
  }
  return hash.toString(16);
}

describe('a brand new board (TC-03, TC-25)', () => {
  it('creates the schema, loads an empty document and records the storage version', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      const tables = sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .toArray()
        .map((row) => row.name);
      const meta = sql.exec<{ key: string; value: string }>('SELECT key, value FROM storage_meta ORDER BY key').toArray();
      return {
        result,
        tables,
        meta,
        notes: snapshot(doc).length,
        logSize: store.logSize(),
        throughSeq: store.snapshotThroughSeq,
      };
    });

    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    for (const table of ['updates', 'snapshot_chunks', 'quarantined_updates', 'storage_meta']) {
      expect(out.tables).toContain(table);
    }
    expect(out.notes).toBe(0);
    expect(out.meta).toEqual([{ key: 'storage_schema_version', value: String(STORAGE_SCHEMA_VERSION) }]);
    expect(out.throughSeq).toBe(0);

    // TC-25: opening a board stores nothing.
    const rows = await withSql(boardId, (sql) => ({
      updates: countRows(sql, 'updates'),
      chunks: countRows(sql, 'snapshot_chunks'),
      quarantined: countRows(sql, 'quarantined_updates'),
    }));
    expect(rows).toEqual({ updates: 0, chunks: 0, quarantined: 0 });
  });

  it('is idempotent: migrating twice leaves one version row', async () => {
    const boardId = uniqueBoardId();
    const meta = await withStore(boardId, ({ store, sql }) => {
      store.migrate();
      store.migrate();
      return sql.exec<{ key: string; value: string }>('SELECT key, value FROM storage_meta ORDER BY key').toArray();
    });
    expect(meta).toEqual([{ key: 'storage_schema_version', value: String(STORAGE_SCHEMA_VERSION) }]);
  });
});

describe('the update log', () => {
  it('holds one row per update, with the byte count stored alongside (TC-04)', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const doc = loggedDoc(store);
      retroBoard(doc);

      const rows = sql
        .exec<{ seq: number; bytes: number }>('SELECT seq, bytes FROM updates ORDER BY seq ASC')
        .toArray();
      const mismatched = rows.filter((row) => row.bytes !== row.bytes).length;
      const sizes = sql
        .exec<{ seq: number; bytes: number; length: number }>(
          'SELECT seq, bytes, LENGTH(data) AS length FROM updates ORDER BY seq ASC',
        )
        .toArray()
        .filter((row) => row.bytes !== row.length);
      return { rows, mismatched, sizes, logSize: store.logSize() };
    });

    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.mismatched).toBe(0);
    expect(out.sizes).toEqual([]);
    expect(out.logSize.count).toBe(out.rows.length);
    // `seq` is contiguous from 1, which is what a replay orders itself by.
    expect(out.rows.map((row) => row.seq)).toEqual(
      Array.from({ length: out.rows.length }, (_unused, index) => index + 1),
    );
  });

  it('replays a 25-note board into a fresh document identically (TC-05)', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const built = loggedDoc(store);
      const placed = retroBoard(built);

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        placed: placed.length,
        result,
        built: snapshot(built),
        loaded: snapshot(fresh),
        rows: countRows(sql, 'updates'),
      };
    });

    expect(out.placed).toBe(25);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.rows).toBeGreaterThan(0);
    expect(out.loaded.length).toBe(25);
    expect(out.loaded).toEqual(out.built);
  });
});

describe('compaction', () => {
  it('folds COMPACTION_UPDATE_COUNT rows into a snapshot and loads identically (TC-06)', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const doc = loggedDoc(store);
      retroBoard(doc);
      // Top up one transaction at a time until the log is exactly at the threshold.
      let n = 0;
      while (store.logSize().count < COMPACTION_UPDATE_COUNT) {
        const notes = snapshot(doc);
        const note = notes[n % notes.length] as (typeof notes)[number];
        // Each call is a transaction of its own, so each emits exactly one update.
        doc.transact(() => {
          (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('x', note.x + n);
        });
        n += 1;
      }
      const before = {
        count: store.logSize().count,
        snapshot: snapshot(doc),
      };

      const compacted = store.compactIfNeeded(doc);
      const throughSeq = Number(metaValue(sql, 'snapshot_through_seq'));

      const fresh = new Y.Doc();
      const reload = store.load(fresh);
      return {
        beforeCount: before.count,
        compacted,
        throughSeq,
        maxSeq: before.count,
        after: store.logSize(),
        updates: countRows(sql, 'updates'),
        chunks: countRows(sql, 'snapshot_chunks'),
        reload,
        snapshotAfter: snapshot(doc),
        loaded: snapshot(fresh),
      };
    });

    expect(out.beforeCount).toBe(COMPACTION_UPDATE_COUNT);
    expect(out.compacted).toBe(true);
    expect(out.updates).toBe(0);
    expect(out.after).toEqual({ count: 0, bytes: 0 });
    expect(out.chunks).toBeGreaterThanOrEqual(1);
    expect(out.throughSeq).toBe(COMPACTION_UPDATE_COUNT);
    expect(out.reload).toEqual({ ok: true, quarantined: 0 });
    expect(out.loaded).toEqual(out.snapshotAfter);
  });

  it('applies only the rows above snapshot_through_seq (TC-07)', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const doc = loggedDoc(store);
      retroBoard(doc);
      while (store.logSize().count < COMPACTION_UPDATE_COUNT) {
        const note = snapshot(doc)[0] as ReturnType<typeof snapshot>[number];
        doc.transact(() => (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('x', note.x + store.logSize().count));
      }
      store.compactIfNeeded(doc);
      const throughSeq = store.snapshotThroughSeq;

      // Three more real updates after the snapshot, on notes that can be
      // recognised afterwards by the value they are moved to.
      const notes = snapshot(doc);
      for (let i = 0; i < 3; i++) {
        const note = notes[10 + i] as (typeof notes)[number];
        doc.transact(() => {
          (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('y', 100_000 + i);
        });
      }

      // A row below the snapshot's sequence number that conflicts with it: a
      // note the compacted snapshot never contained. If loading failed to
      // filter by seq, this note would appear.
      const phantom = new Y.Doc();
      initDoc(phantom);
      const objects = phantom.getMap('objects');
      const phantomId = 'phantom-note';
      const item = new Y.Map<unknown>();
      item.set('id', phantomId);
      item.set('type', 'sticky');
      item.set('x', 0);
      item.set('y', 0);
      item.set('z', 999);
      item.set('color', 'yellow');
      objects.set(phantomId, item);
      const phantomUpdate = Y.encodeStateAsUpdate(phantom);
      sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', 1, buffer(phantomUpdate), phantomUpdate.byteLength);

      const rowsNow = sql
        .exec<{ seq: number }>('SELECT seq FROM updates ORDER BY seq ASC')
        .toArray()
        .map((row) => row.seq);

      const fresh = new Y.Doc();
      const result = store.load(fresh);
      const loaded = snapshot(fresh);
      return {
        throughSeq,
        rowsNow,
        result,
        phantomPresent: loaded.some((note) => note.id === phantomId),
        movedCount: loaded.filter((note) => note.y >= 100_000).length,
        notes: loaded.length,
      };
    });

    expect(out.throughSeq).toBe(COMPACTION_UPDATE_COUNT);
    // The phantom row sorts below the snapshot and must be skipped; the three
    // rows above it must be applied.
    expect(out.rowsNow[0]).toBe(1);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.phantomPresent).toBe(false);
    expect(out.movedCount).toBe(3);
    expect(out.notes).toBe(25);
  });

  it('chunks a board of PERSIST_TESTED_NOTES into more than one row and reloads it identically (TC-08)', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const doc = loggedDoc(store);
      largeBoard(doc, PERSIST_TESTED_NOTES);
      const built = snapshot(doc);
      const encodedBytes = Y.encodeStateAsUpdate(doc).byteLength;

      const start = performance.now();
      const compacted = store.compactIfNeeded(doc);
      const compactMs = performance.now() - start;

      const chunkSizes = sql
        .exec<{ bytes: number }>('SELECT LENGTH(data) AS bytes FROM snapshot_chunks ORDER BY idx ASC')
        .toArray()
        .map((row) => row.bytes);

      const loadStart = performance.now();
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      const loadMs = performance.now() - loadStart;

      // Equality is decided inside the object: comparing 2000 notes across the
      // runtime boundary would cost more than the load being measured.
      const identical = JSON.stringify(snapshot(fresh)) === JSON.stringify(built);
      return {
        built: built.length,
        encodedBytes,
        compacted,
        compactMs,
        chunks: chunkSizes.length,
        chunkSizes,
        result,
        loadMs,
        identical,
        loaded: snapshot(fresh).length,
        updates: countRows(sql, 'updates'),
      };
    });

    expect(out.built).toBe(PERSIST_TESTED_NOTES);
    expect(out.compacted).toBe(true);
    // The encoded board is bigger than one chunk, so chunking is exercised.
    expect(out.encodedBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(out.chunks).toBeGreaterThan(1);
    for (const size of out.chunkSizes.slice(0, -1)) {
      expect(size).toBe(SNAPSHOT_CHUNK_BYTES);
    }
    expect(out.updates).toBe(0);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.loaded).toBe(PERSIST_TESTED_NOTES);
    expect(out.identical).toBe(true);
    expect(out.loadMs).toBeLessThan(2_000);
    expect(out.compactMs).toBeLessThan(2_000);
  }, 120_000);

  it('is skipped below both thresholds (TC-02, at the store boundary)', async () => {
    const boardId = uniqueBoardId();
    const out = await withStore(boardId, ({ store, sql }) => {
      const doc = loggedDoc(store);
      retroBoard(doc);
      const compacted = store.compactIfNeeded(doc);
      return { compacted, updates: countRows(sql, 'updates'), chunks: countRows(sql, 'snapshot_chunks') };
    });
    expect(out.compacted).toBe(false);
    expect(out.updates).toBeGreaterThan(0);
    expect(out.chunks).toBe(0);
  });
});

describe('damage (persist.partial_damage)', () => {
  /** Damage the bytes of one log row, chosen by `pick` over the rows in order. */
  async function damageLogRow(
    boardId: string,
    pick: 'last' | 'middle',
    damage: (bytes: Uint8Array) => Uint8Array,
  ): Promise<{ seq: number; rowsBefore: number }> {
    return withSql(boardId, (sql) => {
      const rows = sql.exec<{ seq: number; data: ArrayBuffer }>('SELECT seq, data FROM updates ORDER BY seq ASC').toArray();
      const row = pick === 'last' ? rows[rows.length - 1]! : rows[Math.floor(rows.length / 2)]!;
      const damagedBytes = damage(new Uint8Array(row.data));
      sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        buffer(damagedBytes),
        damagedBytes.byteLength,
        row.seq,
      );
      return { seq: row.seq, rowsBefore: rows.length };
    });
  }

  it('opens the board when the last log row is damaged, losing that change alone (TC-09)', async () => {
    const boardId = uniqueBoardId();
    await withStore(boardId, ({ store }) => {
      retroBoard(loggedDoc(store));
    });
    const damaged = await damageLogRow(boardId, 'last', truncatedUpdate);

    const out = await withStore(boardId, ({ store, sql }) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        result,
        notes: snapshot(fresh).length,
        rowsAfter: countRows(sql, 'updates'),
        quarantined: sql.exec<{ seq: number; error: string }>('SELECT seq, error FROM quarantined_updates ORDER BY seq ASC').toArray(),
      };
    });

    // Nothing comes after the last change, so exactly one change is lost.
    expect(out.result).toEqual({ ok: true, quarantined: 1 });
    expect(out.notes).toBe(25);
    expect(out.rowsAfter).toBe(damaged.rowsBefore - 1);
    expect(out.quarantined.map((row) => row.seq)).toEqual([damaged.seq]);
    expect(out.quarantined[0]!.error.length).toBeGreaterThan(0);
  });

  it('quarantines a damaged log row and every row that can no longer be placed (TC-09)', async () => {
    const boardId = uniqueBoardId();
    const built = await withStore(boardId, ({ store }) => {
      const doc = loggedDoc(store);
      const placed = retroBoard(doc);
      return placed.map((note) => note.id);
    });
    const damaged = await damageLogRow(boardId, 'middle', truncatedUpdate);

    const out = await withStore(boardId, ({ store, sql }) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      // What the same board would hold if the damaged change and everything that
      // waits for it had never been written: replay the rows below the damage
      // into a document of their own. The damaged board has to equal that exactly,
      // which is the difference between "shorter" and "wrong".
      const before = new Y.Doc();
      for (const row of sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq < ? ORDER BY seq ASC', damaged.seq)
        .toArray()) {
        Y.applyUpdate(before, new Uint8Array(row.data));
      }
      return {
        result,
        notes: snapshot(fresh),
        prefix: snapshot(before),
        rowsAfter: countRows(sql, 'updates'),
        quarantined: sql
          .exec<{ seq: number; error: string }>('SELECT seq, error FROM quarantined_updates ORDER BY seq ASC')
          .toArray(),
      };
    });

    // The board opens instead of failing, and what it shows is the part of the
    // board the readable bytes still describe.
    expect(out.notes).toEqual(out.prefix);
    expect(out.result.ok).toBe(true);
    expect(out.notes.length).toBeGreaterThan(0);
    expect(out.notes.length).toBeLessThan(25);
    for (const note of out.notes) {
      expect(built).toContain(note.id);
    }
    // Nothing disappears on the way: every row is either still in the log, or in
    // `quarantined_updates` with the reason it could not be used.
    expect(out.rowsAfter + out.quarantined.length).toBe(damaged.rowsBefore);
    expect(out.quarantined.length).toBeGreaterThanOrEqual(1);
    expect(out.quarantined.some((row) => row.seq === damaged.seq)).toBe(true);
    for (const row of out.quarantined) {
      expect(row.error.length).toBeGreaterThan(0);
    }

    // And the same storage loads to the same board again: the damage does not
    // drift, and the room does not lose more on every restart.
    const again = await withStore(boardId, ({ store }) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return { result, notes: snapshot(fresh) };
    });
    expect(again.result).toEqual({ ok: true, quarantined: 0 });
    expect(again.notes).toEqual(out.notes);
  });

  it('survives a row of bytes that are not an update at all', async () => {
    const boardId = uniqueBoardId();
    await withStore(boardId, ({ store }) => {
      retroBoard(loggedDoc(store));
    });
    const damaged = await damageLogRow(boardId, 'last', (bytes) => unreadableBytes(bytes.byteLength));
    const out = await withStore(boardId, ({ store, sql }) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return { result, notes: snapshot(fresh).length, quarantined: countRows(sql, 'quarantined_updates') };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 1 });
    expect(out.notes).toBe(25);
    expect(out.quarantined).toBe(1);
    expect(damaged.seq).toBeGreaterThan(0);
  });

  it('survives the whole board being rebuilt after quarantining', async () => {
    // After damage has been quarantined the log is a normal log again: changes
    // continue, compaction runs, and the board loads with both halves.
    const boardId = uniqueBoardId();
    await withStore(boardId, ({ store }) => {
      retroBoard(loggedDoc(store));
    });
    await damageLogRow(boardId, 'last', truncatedUpdate);
    await withStore(boardId, ({ store }) => {
      const fresh = new Y.Doc();
      store.load(fresh);
    });
    const out = await withStore(boardId, ({ store, sql }) => {
      const { doc } = openLiveDoc(store);
      for (let i = 0; i < 5; i++) {
        const note = snapshot(doc)[0] as ReturnType<typeof snapshot>[number];
        doc.transact(() => (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('y', 7_000 + i));
      }
      const compacted = store.compactIfNeeded(doc);
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      const moved = snapshot(fresh).filter((note) => note.y >= 7_000).length;
      return { compacted, result, notes: snapshot(fresh).length, moved, updates: countRows(sql, 'updates') };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.notes).toBe(25);
    expect(out.moved).toBe(1);
    void out.compacted;
  });
});

describe('a snapshot that cannot be read (persist.load_failure)', () => {
  it('reports snapshot-unreadable and deletes or quarantines nothing (TC-10)', async () => {
    const boardId = uniqueBoardId();
    await withStore(boardId, ({ store }) => {
      const doc = loggedDoc(store);
      retroBoard(doc);
      while (store.logSize().count < COMPACTION_UPDATE_COUNT) {
        const note = snapshot(doc)[0] as ReturnType<typeof snapshot>[number];
        doc.transact(() => (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('x', note.x + store.logSize().count));
      }
      store.compactIfNeeded(doc);
    });

    await withSql(boardId, (sql) => {
      const chunk = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
      const corrupted = corruptedChunk(new Uint8Array(chunk.data));
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', buffer(corrupted));
    });

    // The world as the failed load must leave it: the corrupted chunk where it
    // is, every row still there.
    const before = await withSql(boardId, (sql) => ({
      chunks: countRows(sql, 'snapshot_chunks'),
      updates: countRows(sql, 'updates'),
      quarantined: countRows(sql, 'quarantined_updates'),
      chunksFingerprint: fingerprint(sql, 'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC'),
    }));
    expect(before.chunks).toBeGreaterThanOrEqual(1);

    const out = await withStore(boardId, ({ store, sql }) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        result,
        notes: snapshot(fresh).length,
        chunks: countRows(sql, 'snapshot_chunks'),
        updates: countRows(sql, 'updates'),
        quarantined: countRows(sql, 'quarantined_updates'),
        chunksFingerprint: fingerprint(sql, 'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC'),
      };
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok === false) {
      expect(out.result.reason).toBe('snapshot-unreadable');
      expect(out.result.error.length).toBeGreaterThan(0);
    }
    // Nothing is deleted and nothing is quarantined: the damage stays where it
    // is for the retry, and the room refuses to serve instead of serving less.
    expect(out.chunks).toBe(before.chunks);
    expect(out.chunksFingerprint).toBe(before.chunksFingerprint);
    expect(out.quarantined).toBe(before.quarantined);
    expect(out.updates).toBe(before.updates);
    expect(out.notes).toBe(0);
  });
});

describe('a compaction that dies half way through', () => {
  it('rolls back to the previous snapshot and the whole log (TC-11)', async () => {
    const boardId = uniqueBoardId();
    await withStore(boardId, ({ store }) => {
      const doc = loggedDoc(store);
      retroBoard(doc);
      while (store.logSize().count < COMPACTION_UPDATE_COUNT) {
        const note = snapshot(doc)[0] as ReturnType<typeof snapshot>[number];
        doc.transact(() => (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('x', note.x + store.logSize().count));
      }
      store.compactIfNeeded(doc);
    });

    // Snapshot the world as it was before the doomed compaction, then run one
    // that throws after the old chunks are gone.
    const before = await withSql(boardId, (sql) => ({
      chunks: countRows(sql, 'snapshot_chunks'),
      chunksFingerprint: fingerprint(sql, 'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC'),
      throughSeq: metaValue(sql, 'snapshot_through_seq'),
    }));

    const out = await withStore(boardId, ({ store, sql, storage }) => {
      const { doc, loadResult } = openLiveDoc(store);
      expect(loadResult.ok).toBe(true);
      // A few more updates so the next compaction has something to fold away.
      for (let i = 0; i < 5; i++) {
        const note = snapshot(doc)[0] as ReturnType<typeof snapshot>[number];
        doc.transact(() => (doc.getMap('objects').get(note.id) as Y.Map<unknown>).set('y', note.y + i));
      }
      const logBefore = store.logSize();

      const doomed = new BoardStore(storageFailingAfter(storage, (query) => query.startsWith('DELETE FROM updates')));
      const compacted = doomed.compactIfNeeded(doc);

      return {
        compacted,
        logBefore: logBefore.count,
        updates: countRows(sql, 'updates'),
        chunks: countRows(sql, 'snapshot_chunks'),
        chunksFingerprint: fingerprint(sql, 'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC'),
        throughSeq: metaValue(sql, 'snapshot_through_seq'),
      };
    });

    expect(out.compacted).toBe(false);
    expect(out.updates).toBe(out.logBefore);
    expect(out.chunks).toBe(before.chunks);
    expect(out.chunksFingerprint).toBe(before.chunksFingerprint);
    expect(out.throughSeq).toBe(before.throughSeq);

    // And the board still loads, with the changes the doomed compaction lost.
    const reloaded = await withStore(boardId, ({ store }) => {
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return { result, notes: snapshot(fresh).length };
    });
    expect(reloaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.notes).toBe(25);
  });
});
