/**
 * persist.board_store, integration: the store against real SQLite-backed Durable
 * Object storage (TC-03 to TC-11, TC-25).
 *
 * Each case gets its own board id, so each gets a fresh object and a fresh
 * database — including the "never edited" board of TC-25, which is a `migrate()`
 * and nothing else. Boards are built with the real board mutations, and every
 * update the document produces is appended as it happens, the way the room does.
 */

import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { moveObject, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { BoardStore, LOAD_ORIGIN, toArrayBuffer } from '../../src/worker/board-store';
import type { BoardRoom, Env as WorkerEnv } from '../../src/worker/index';
import { largeBoard, randomBytesLike, retroBoard, truncatedUpdate } from '../fixtures/boards';

/**
 * The pool hands out `env` typed by generated Cloudflare types that are not
 * committed, so the namespace is asserted through the Worker's own class.
 */
const namespace = (env as unknown as WorkerEnv).BOARD_ROOM;

/** A board nobody has ever seen: every case runs against its own object. */
function freshStub(): DurableObjectStub<BoardRoom> {
  return namespace.get(namespace.idFromName(newBoardId()));
}

/** A migrated store on this board's storage. */
function migratedStore(state: DurableObjectState): BoardStore {
  const store = new BoardStore(state.storage);
  store.migrate();
  return store;
}

/** Mirror the room: every update the document produces becomes exactly one log row. */
function storeEveryUpdate(doc: Y.Doc, store: BoardStore): void {
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== LOAD_ORIGIN) store.append(update);
  });
}

/** The shape of one board's storage, read straight from SQL. */
function storageShape(state: DurableObjectState) {
  const sql = state.storage.sql;
  const one = (query: string): number => {
    const row = sql.exec<{ n: number | string }>(query).one();
    return typeof row.n === 'number' ? row.n : Number(row.n);
  };
  return {
    tables: sql
      .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC`)
      .toArray()
      .map((row) => row.name),
    updates: one('SELECT COUNT(*) AS n FROM updates'),
    updateBytes: one('SELECT COALESCE(SUM(bytes), 0) AS n FROM updates'),
    minSeq: one('SELECT COALESCE(MIN(seq), 0) AS n FROM updates'),
    maxSeq: one('SELECT COALESCE(MAX(seq), 0) AS n FROM updates'),
    chunks: one('SELECT COUNT(*) AS n FROM snapshot_chunks'),
    chunkSizes: sql
      .exec<{ n: number }>('SELECT LENGTH(data) AS n FROM snapshot_chunks ORDER BY idx ASC')
      .toArray()
      .map((row) => row.n),
    quarantined: one('SELECT COUNT(*) AS n FROM quarantined_updates'),
  };
}

/** Everything a reload sees: the load outcome, the board it produced, and the counts. */
function reload(state: DurableObjectState) {
  const store = new BoardStore(state.storage);
  const doc = new Y.Doc();
  const load = store.load(doc);
  return { load, notes: snapshot(doc), summary: store.summary(), shape: storageShape(state) };
}

/** Read one log row's bytes. */
function readRow(state: DurableObjectState, seq: number): Uint8Array {
  const row = state.storage.sql
    .exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = ?', seq)
    .one();
  return new Uint8Array(row.data);
}

/** Replace a log row's content with damaged bytes (TC-09). */
function damageUpdateRow(state: DurableObjectState, seq: number, damaged: Uint8Array): void {
  state.storage.sql.exec(
    'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
    toArrayBuffer(damaged),
    damaged.byteLength,
    seq,
  );
}

/** Replace a snapshot chunk with damaged bytes (TC-10). */
function damageSnapshotChunk(state: DurableObjectState, idx: number, damaged: Uint8Array): void {
  state.storage.sql.exec(
    'UPDATE snapshot_chunks SET data = ? WHERE idx = ?',
    toArrayBuffer(damaged),
    idx,
  );
}

/** A real mutation of one note, and so exactly one Yjs update / log row. */
function nudgeNote(doc: Y.Doc, id: string, delta: number): void {
  const note = snapshot(doc).find((entry) => entry.id === id);
  if (note) moveObject(doc, id, note.x + delta, note.y + delta);
}

/**
 * A 25-note retro board whose every mutation was stored as it happened, nudged
 * until the log holds `rows` rows (the thresholds are reached with real moves).
 */
function buildRetroBoard(state: DurableObjectState, rows: number | null = null) {
  const store = migratedStore(state);
  const doc = new Y.Doc();
  storeEveryUpdate(doc, store);
  const ids = retroBoard(doc);
  if (rows !== null) {
    for (let guard = 0; storageShape(state).updates < rows; guard++) {
      nudgeNote(doc, ids[guard % ids.length] as string, 0.5 + guard);
      if (guard > 4_000) throw new Error(`could not reach ${rows} log rows`);
    }
  }
  return { store, doc, ids };
}

/** Any note id from the board, for a mutation that just needs one that exists. */
function noteIds(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>('objects').keys()];
}

/** Order-independent comparison of two boards as saved. */
function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const texts = (entries: readonly StickySnapshot[]) =>
    [...entries].map((entry) => `${entry.id}|${entry.x}|${entry.y}|${entry.color}|${entry.z}|${entry.text}`).sort();
  return JSON.stringify(texts(a)) === JSON.stringify(texts(b));
}

describe('BoardStore on real Durable Object storage', () => {
  it('TC-03: loads a board that has never been used as empty, not as damaged', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const store = migratedStore(state);
      const doc = new Y.Doc();
      return { load: store.load(doc), notes: snapshot(doc).length, shape: storageShape(state), summary: store.summary() };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toBe(0);
    expect(result.shape.updates).toBe(0);
    expect(result.shape.chunks).toBe(0);
    expect(result.shape.quarantined).toBe(0);
    // The tables exist after migrate, and nothing else was written
    // (`sqlite_sequence` comes with AUTOINCREMENT).
    expect(result.shape.tables).toEqual([
      'quarantined_updates',
      'snapshot_chunks',
      'sqlite_sequence',
      'storage_meta',
      'updates',
    ]);
    expect(result.summary.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
  });

  it('TC-04: appends one update as one row whose byte count and bytes match', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const store = migratedStore(state);
      const before = storageShape(state);

      // One update, the way a client sends one: the whole state of a built board.
      const source = new Y.Doc();
      retroBoard(source);
      const update = Y.encodeStateAsUpdate(source);
      store.append(update);

      const stored = readRow(state, 1);
      const bytes = state.storage.sql.exec<{ bytes: number }>('SELECT bytes FROM updates WHERE seq = 1').one();
      return {
        before,
        after: storageShape(state),
        bytesColumn: bytes.bytes,
        stored: Array.from(stored),
        sent: Array.from(update),
      };
    });

    expect(result.before.updates).toBe(0);
    expect(result.after.updates).toBe(1);
    // The `bytes` column is the length of the update, not the row overhead.
    expect(result.bytesColumn).toBe(result.sent.length);
    expect(result.after.updateBytes).toBe(result.sent.length);
    // Byte-for-byte identity of the BLOB.
    expect(result.stored).toEqual(result.sent);
  });

  it('TC-05: a board that is only a log reloads identically', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { doc } = buildRetroBoard(state);
      const reloaded = reload(state);
      return {
        shape: storageShape(state),
        load: reloaded.load,
        throughSeq: reloaded.summary.snapshotThroughSeq,
        notes: reloaded.notes,
        original: snapshot(doc),
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    // Nothing was compacted, so the log is the whole board.
    expect(result.shape.chunks).toBe(0);
    expect(result.throughSeq).toBe(0);
    expect(result.shape.updates).toBeGreaterThan(25);
    expect(result.notes.length).toBe(25);
    expect(result.notes).toEqual(result.original);
  });

  it('TC-06: compacts at COMPACTION_UPDATE_COUNT rows and reloads identically', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { store, doc } = buildRetroBoard(state, COMPACTION_UPDATE_COUNT);
      const before = storageShape(state);
      const compacted = store.compactIfNeeded(doc);
      const reloaded = reload(state);
      return {
        before,
        compacted,
        load: reloaded.load,
        notes: reloaded.notes,
        original: snapshot(doc),
        summary: reloaded.summary,
        shape: reloaded.shape,
      };
    });

    expect(result.before.updates).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.compacted).toBe(true);
    // The log is gone, the snapshot carries the board, and the marker is at the top.
    expect(result.shape.updates).toBe(0);
    expect(result.shape.chunks).toBeGreaterThanOrEqual(1);
    expect(result.summary.snapshotThroughSeq).toBe(result.before.maxSeq);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toEqual(result.original);
  });

  it('TC-06: leaves the log alone below COMPACTION_UPDATE_COUNT', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { store, doc } = buildRetroBoard(state, COMPACTION_UPDATE_COUNT - 1);
      const before = storageShape(state);
      const compacted = store.compactIfNeeded(doc);
      return { before, compacted, shape: storageShape(state) };
    });

    expect(result.before.updates).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(result.compacted).toBe(false);
    expect(result.shape).toEqual(result.before);
  });

  it('TC-07: replays only the rows written after the snapshot', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { store, doc } = buildRetroBoard(state);
      expect(store.compact(doc)).toBe(true);
      const compacted = storageShape(state);

      // Three more changes, stored as the room would store them.
      const ids = noteIds(doc);
      for (const [index, id] of [ids[0], ids[1], ids[2]].entries()) {
        nudgeNote(doc, id as string, 10 + index);
      }
      const reloaded = reload(state);
      return {
        compacted,
        shape: reloaded.shape,
        throughSeq: reloaded.summary.snapshotThroughSeq,
        load: reloaded.load,
        notes: reloaded.notes,
        original: snapshot(doc),
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.compacted.updates).toBe(0);
    expect(result.shape.updates).toBe(3);
    // Every remaining row is after the snapshot, so nothing is applied twice.
    expect(result.shape.minSeq).toBeGreaterThan(result.throughSeq);
    expect(result.notes).toEqual(result.original);
  });

  it('TC-08: compacts a PERSIST_TESTED_NOTES board into chunks that reload equal', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const store = migratedStore(state);
      const doc = new Y.Doc();
      storeEveryUpdate(doc, store);

      const built = Date.now();
      largeBoard(doc);
      const builtMs = Date.now() - built;

      const encoded = Y.encodeStateAsUpdate(doc).byteLength;
      const compactStart = Date.now();
      const compacted = store.compact(doc);
      const compactMs = Date.now() - compactStart;

      const loadStart = Date.now();
      const reloaded = reload(state);
      const loadMs = Date.now() - loadStart;

      return {
        builtMs,
        compactMs,
        loadMs,
        encoded,
        compacted,
        shape: reloaded.shape,
        summary: reloaded.summary,
        load: reloaded.load,
        notes: reloaded.notes,
        equal: sameBoard(reloaded.notes, snapshot(doc)),
        textLengths: reloaded.notes.map((note) => note.text.length),
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes.length).toBe(2000);
    expect(result.textLengths.every((length) => length >= 10 && length <= 300)).toBe(true);

    // The snapshot is split at SNAPSHOT_CHUNK_BYTES, so more than one row once the
    // encoded state is larger than a chunk.
    expect(result.shape.chunkSizes.every((size) => size <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    expect(result.shape.chunks).toBe(Math.ceil(result.encoded / SNAPSHOT_CHUNK_BYTES));
    if (result.encoded > SNAPSHOT_CHUNK_BYTES) expect(result.shape.chunks).toBeGreaterThan(1);
    expect(result.summary.updateCount).toBe(0);
    expect(result.equal).toBe(true);
    console.info(
      `TC-08 ${result.encoded} bytes in ${result.shape.chunks} chunk rows; ` +
        `build ${result.builtMs}ms, compact ${result.compactMs}ms, storage load ${result.loadMs}ms`,
    );
  });

  it('TC-09: quarantines a log row whose bytes are noise and keeps the other notes', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { doc } = buildRetroBoard(state);
      const before = storageShape(state);
      damageUpdateRow(state, 7, randomBytesLike(readRow(state, 7)));
      const reloaded = reload(state);
      return {
        before,
        load: reloaded.load,
        summary: reloaded.summary,
        shape: reloaded.shape,
        notes: reloaded.notes,
        original: snapshot(doc),
        quarantined: state.storage.sql
          .exec<{ seq: number; bytes: number; error: string }>(
            'SELECT seq, error FROM quarantined_updates',
          )
          .toArray(),
      };
    });

    expect(result.load.ok).toBe(true);
    if (result.load.ok) expect(result.load.quarantined).toBe(1);
    expect(result.shape.quarantined).toBe(1);
    expect(result.summary.quarantined).toBe(1);
    // The damaged row left the log, and the reason was kept with it.
    expect(result.shape.updates).toBe(result.before.updates - 1);
    expect(result.quarantined.length).toBe(1);
    expect(result.quarantined[0]?.error.length).toBeGreaterThan(0);
    // One change lost, not one board: everything else came back as it was.
    expect(result.notes.length).toBe(result.original.length - 1);
    const missing = result.original.filter((note) => !result.notes.some((n) => n.id === note.id));
    expect(missing.length).toBe(1);
    for (const note of result.notes) expect(result.original).toContainEqual(note);
  });

  it('TC-09: quarantines a log row that was cut short', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { doc } = buildRetroBoard(state);
      damageUpdateRow(state, 7, truncatedUpdate(readRow(state, 7)));
      const reloaded = reload(state);
      return { load: reloaded.load, notes: reloaded.notes.length, original: snapshot(doc).length, shape: reloaded.shape };
    });

    expect(result.load.ok).toBe(true);
    if (result.load.ok) expect(result.load.quarantined).toBe(1);
    expect(result.shape.quarantined).toBe(1);
    expect(result.notes).toBe(result.original - 1);
  });

  it('TC-10: refuses to serve a board whose snapshot is unreadable, damaging nothing', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const { store, doc } = buildRetroBoard(state);
      expect(store.compact(doc)).toBe(true);
      // Keep editing, so a partial load might have been tempted to use the log.
      nudgeNote(doc, noteIds(doc)[0] as string, 5);
      const before = storageShape(state);

      const chunk = state.storage.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
        .one();
      damageSnapshotChunk(state, 0, randomBytesLike(new Uint8Array(chunk.data)));

      const reloaded = reload(state);
      return {
        before,
        shape: reloaded.shape,
        load: reloaded.load,
        summary: reloaded.summary,
        storedChunkBytes: readChunkBytes(state, 0),
      };
    });

    expect(result.load.ok).toBe(false);
    if (!result.load.ok) {
      expect(result.load.reason).toBe('snapshot-unreadable');
      expect(result.load.error.length).toBeGreaterThan(0);
    }
    // Nothing was deleted and nothing was quarantined: the board is left as it is,
    // so a later attempt (or a human) still has everything to work with.
    expect(result.shape).toEqual(result.before);
    expect(result.summary.quarantined).toBe(0);
    expect(result.storedChunkBytes.length).toBeGreaterThan(0);
  });

  it('TC-11: rolls compaction back when a write fails, and compacts on the next try', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      // A store whose write after the old chunks are deleted fails, standing in
      // for the platform refusing a statement: BoardStore itself never fails on
      // purpose. This is the only place the failure is invented.
      class FailingStore extends BoardStore {
        protected override afterChunksDeleted(): void {
          throw new Error('injected SQL failure');
        }
      }

      const { store, doc } = buildRetroBoard(state);
      expect(store.compact(doc)).toBe(true);
      for (let i = 0; i < 5; i++) nudgeNote(doc, noteIds(doc)[i % 3] as string, 3 + i);
      const before = storageShape(state);
      const beforeReload = reload(state);

      const failed = new FailingStore(state.storage).compact(doc);
      const afterFailure = storageShape(state);
      const afterFailureReload = reload(state);

      // The same board, one normal attempt later.
      new BoardStore(state.storage).compact(doc);

      return {
        failed,
        before,
        afterFailure,
        throughBefore: beforeReload.summary.snapshotThroughSeq,
        throughAfter: afterFailureReload.summary.snapshotThroughSeq,
        previousSnapshotStillGood: sameBoard(afterFailureReload.notes, beforeReload.notes),
        afterRetry: storageShape(state),
        finalNotes: reload(state).notes.length,
        original: snapshot(doc).length,
      };
    });

    expect(result.failed).toBe(false);
    // Previous chunks and log rows are exactly as they were, marker included.
    expect(result.afterFailure).toEqual(result.before);
    expect(result.throughAfter).toBe(result.throughBefore);
    expect(result.previousSnapshotStillGood).toBe(true);
    // And the board compacts fine on the next attempt.
    expect(result.afterRetry.updates).toBe(0);
    expect(result.finalNotes).toBe(result.original);
  });

  it('TC-25: a board that was opened but never edited has no rows at all', async () => {
    const result = await runInDurableObject(freshStub(), (_instance, state) => {
      const store = migratedStore(state);
      const doc = new Y.Doc();
      // All a client does to a board it never touches: open it.
      const load = store.load(doc);
      const compacted = store.compactIfNeeded(doc);
      return { load, compacted, shape: storageShape(state), summary: store.summary(), again: reload(state) };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.shape.updates).toBe(0);
    expect(result.shape.chunks).toBe(0);
    expect(result.summary).toEqual({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      updateCount: 0,
      updateBytes: 0,
      snapshotChunks: 0,
      snapshotThroughSeq: 0,
      quarantined: 0,
    });
    // Nothing to compact, so nothing gets written either.
    expect(result.compacted).toBe(false);
    expect(result.shape.updates).toBe(0);
    expect(result.shape.chunks).toBe(0);
    expect(result.again.load).toEqual({ ok: true, quarantined: 0 });
  });
});

/** The bytes of one snapshot chunk, to compare damage against. */
function readChunkBytes(state: DurableObjectState, idx: number): number[] {
  const row = state.storage.sql
    .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = ?', idx)
    .one();
  return Array.from(new Uint8Array(row.data));
}
