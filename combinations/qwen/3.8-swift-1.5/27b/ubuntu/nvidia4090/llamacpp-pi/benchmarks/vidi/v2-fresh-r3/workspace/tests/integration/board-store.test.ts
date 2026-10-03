import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { SqlStorage } from 'cloudflare:workers';
import * as Y from 'yjs';
import { BoardStore } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import {
  buildRetroBoard,
  buildSimpleBoard,
  buildLargeBoard,
  makeSingleNoteUpdate,
  makeDamagedUpdates,
  textMap,
  type NoteSpec,
} from '../fixtures/boards';

/**
 * Runs `fn` with a BoardStore backed by a fresh board's Durable Object SQLite
 * storage. Each call uses a unique board name so tests are isolated; the DO
 * instance (and its in-memory state) is reused across calls with the same name.
 */
let boardCounter = 0;
function freshBoardName(prefix: string): string {
  return `${prefix}-${++boardCounter}`;
}

async function inBoard<T>(boardName: string, fn: (store: BoardStore, sql: SqlStorage) => T): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardName));
  return runInDurableObject<BoardRoom, T>(stub, (room) => {
    const store = new BoardStore(room.state.storage);
    return fn(store, room.state.storage.sql);
  });
}

/** Appends every update of a built board to the store. */
function appendAll(store: BoardStore, updates: Uint8Array[]): void {
  for (const u of updates) store.append(u);
}

describe('TC-03: Empty board', () => {
  it('migrate + load → tables exist, doc empty, schema version set', async () => {
    const res = await inBoard(freshBoardName('tc03'), (store, sql) => {
      store.migrate();
      const doc = new Y.Doc();
      const result = store.load(doc);
      const tables = sql
        .exec("SELECT name FROM sqlite_master WHERE type='table'")
        .toArray<{ name: string }>()
        .map((r) => r.name)
        .sort();
      const version = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version')
        .one<{ value: string }>()?.value;
      return { result, tables, version, noteCount: doc.getMap('objects').size };
    });
    expect(res.result).toEqual({ ok: true, quarantined: 0 });
    expect(res.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(res.noteCount).toBe(0);
    for (const t of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) {
      expect(res.tables).toContain(t);
    }
  });
});

describe('TC-04: append one update', () => {
  it('→ 1 row, bytes column = update length', async () => {
    const { update } = makeSingleNoteUpdate();
    const res = await inBoard(freshBoardName('tc04'), (store, sql) => {
      store.migrate();
      store.append(update);
      const row = sql.exec('SELECT bytes FROM updates').one<{ bytes: number }>();
      const count = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      return { bytes: row?.bytes, count, len: update.length };
    });
    expect(res.count).toBe(1);
    expect(res.bytes).toBe(res.len);
  });
});

describe('TC-05: LogOnly 25 notes', () => {
  it('load into a fresh doc equals the original snapshot', async () => {
    const { doc: original, updates } = buildRetroBoard();
    const originalTexts = textMap(original);
    const res = await inBoard(freshBoardName('tc05'), (store) => {
      store.migrate();
      appendAll(store, updates);
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, texts: textMap(doc) };
    });
    expect(res.result).toEqual({ ok: true, quarantined: 0 });
    expect(res.texts).toEqual(originalTexts);
    expect(Object.keys(res.texts)).toHaveLength(25);
  });
});

describe('TC-06: Compaction at the update-count threshold', () => {
  it('updates 0, chunks ≥ 1, through_seq = max seq, reload equal', async () => {
    const { doc: original, updates } = buildSimpleBoard(COMPACTION_UPDATE_COUNT);
    const originalTexts = textMap(original);
    const res = await inBoard(freshBoardName('tc06'), (store, sql) => {
      store.migrate();
      appendAll(store, updates);
      const beforeCount = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      const maxSeq = sql.exec('SELECT MAX(seq) AS m FROM updates').one<{ m: number }>()?.m;
      const compacted = store.compactIfNeeded(original);
      const afterCount = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      const chunkCount = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      const throughSeq = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .one<{ value: string }>()?.value;
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { beforeCount, maxSeq, compacted, afterCount, chunkCount, throughSeq, result, texts: textMap(doc) };
    });
    expect(res.beforeCount).toBe(COMPACTION_UPDATE_COUNT);
    expect(res.compacted).toBe(true);
    expect(res.afterCount).toBe(0);
    expect(res.chunkCount).toBeGreaterThanOrEqual(1);
    expect(res.throughSeq).toBe(String(res.maxSeq));
    expect(res.result).toEqual({ ok: true, quarantined: 0 });
    expect(res.texts).toEqual(originalTexts);
  });
});

describe('TC-07: SnapshotPlusLog', () => {
  it('3 updates after compaction → reload has all; only seq > through_seq applied', async () => {
    const base = buildSimpleBoard(COMPACTION_UPDATE_COUNT);
    const doc = base.doc;
    // Add 3 more notes to the SAME doc (one update each).
    const extraUpdates: Uint8Array[] = [];
    const handler = (u: Uint8Array) => extraUpdates.push(u);
    (doc as unknown as { on: (e: string, h: unknown) => void; off: (e: string, h: unknown) => void })
      .on('update', handler);
    const extraNotes: NoteSpec[] = [];
    for (let i = 0; i < 3; i++) {
      const id = createSticky(doc, { x: 900 + i, y: 900 }, 'pink');
      extraNotes.push({ id, text: '', color: 'pink', x: 900 + i, y: 900 });
    }
    (doc as unknown as { off: (e: string, h: unknown) => void }).off('update', handler);
    const originalTexts = textMap(doc);
    const res = await inBoard(freshBoardName('tc07'), (store, sql) => {
      store.migrate();
      appendAll(store, base.updates);
      store.compactIfNeeded(doc);
      appendAll(store, extraUpdates);
      const logCount = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      const minLogSeq = sql.exec('SELECT MIN(seq) AS m FROM updates').one<{ m: number }>()?.m;
      const throughSeq = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .one<{ value: string }>()?.value;
      const doc2 = new Y.Doc();
      const result = store.load(doc2);
      return { logCount, minLogSeq, throughSeq, result, texts: textMap(doc2) };
    });
    expect(res.result).toEqual({ ok: true, quarantined: 0 });
    expect(res.logCount).toBe(3);
    // The log only contains rows after the snapshot's through-seq.
    expect(Number(res.throughSeq)).toBe(COMPACTION_UPDATE_COUNT);
    expect(res.minLogSeq).toBeGreaterThan(Number(res.throughSeq));
    expect(res.texts).toEqual(originalTexts);
    expect(Object.keys(res.texts)).toHaveLength(COMPACTION_UPDATE_COUNT + 3);
  });
});

describe('TC-08: Large board compaction', () => {
  it('multiple chunks when encoded > SNAPSHOT_CHUNK_BYTES; reload equal', async () => {
    const { doc: original, updates } = buildLargeBoard();
    const originalTexts = textMap(original);
    const res = await inBoard(freshBoardName('tc08'), (store, sql) => {
      store.migrate();
      appendAll(store, updates);
      const compacted = store.compactIfNeeded(original);
      const chunkCount = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      // Total snapshot bytes (to confirm it exceeded one chunk).
      const total = sql
        .exec('SELECT SUM(length(data)) AS s FROM snapshot_chunks')
        .one<{ s: number }>()?.s;
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { compacted, chunkCount, total, result, texts: textMap(doc) };
    });
    expect(res.compacted).toBe(true);
    expect(res.total).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(res.chunkCount).toBeGreaterThan(1);
    expect(res.result).toEqual({ ok: true, quarantined: 0 });
    expect(res.texts).toEqual(originalTexts);
  });
});

describe('TC-09: Quarantine a damaged log row (error path)', () => {
  it('overwrite log row 7 with damaged bytes → quarantined 1; row moved; others present', async () => {
    const { updates, notes } = buildSimpleBoard(10);
    const res = await inBoard(freshBoardName('tc09'), (store, sql) => {
      store.migrate();
      appendAll(store, updates);
      const { truncated } = makeDamagedUpdates();
      sql.exec('UPDATE updates SET data = ? WHERE seq = ?', truncated, 7);
      const doc = new Y.Doc();
      const result = store.load(doc);
      const quarantinedCount = result.ok ? result.quarantined : -1;
      const quarantined = sql.exec('SELECT seq, error FROM quarantined_updates').toArray<{ seq: number; error: string }>();
      const ids = [...doc.getMap('objects').keys()];
      return { result, quarantinedCount, quarantined, noteCount: ids.length, missingId: notes[6].id, ids };
    });
    expect(res.result.ok).toBe(true);
    expect(res.quarantinedCount).toBe(1);
    expect(res.quarantined).toHaveLength(1);
    expect(res.quarantined[0].seq).toBe(7);
    expect(res.quarantined[0].error).toBeTruthy();
    expect(res.noteCount).toBe(9);
    expect(res.ids).not.toContain(res.missingId);
  });
});

describe('TC-10: Corrupt snapshot (negative)', () => {
  it('→ {ok:false, reason:snapshot-unreadable}; nothing deleted or quarantined', async () => {
    const { doc, updates } = buildSimpleBoard(COMPACTION_UPDATE_COUNT);
    const res = await inBoard(freshBoardName('tc10'), (store, sql) => {
      store.migrate();
      appendAll(store, updates);
      store.compactIfNeeded(doc);
      const chunkCount = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      const logBefore = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0x01, 0x02, 0x03]);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage);
      const doc2 = new Y.Doc();
      const result = store.load(doc2);
      const quarantined = sql.exec('SELECT COUNT(*) AS c FROM quarantined_updates').one<{ c: number }>()?.c;
      const logAfter = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      const chunkAfter = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      return { chunkCount, logBefore, result, quarantined, logAfter, chunkAfter };
    });
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.reason).toBe('snapshot-unreadable');
    expect(res.quarantined).toBe(0);
    expect(res.logAfter).toBe(res.logBefore);
    expect(res.chunkAfter).toBe(res.chunkCount);
  });
});

describe('TC-11: Compaction rollback (negative)', () => {
  it('throw after chunk delete → previous chunks and log unchanged', async () => {
    const base = buildSimpleBoard(COMPACTION_UPDATE_COUNT);
    const doc = base.doc;
    const res = await inBoard(freshBoardName('tc11'), (store, sql) => {
      store.migrate();
      appendAll(store, base.updates);
      store.compactIfNeeded(doc);
      const chunksBefore = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      const logBefore = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      // Append more so a second compaction is triggered.
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) createSticky(doc, { x: i, y: 0 }, 'yellow');
      // Inject a failure after the chunk delete on the next compaction.
      store.__testFailCompactionAfterChunkDelete = true;
      const compacted = store.compactIfNeeded(doc);
      const chunksAfter = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      const logAfter = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      return { chunksBefore, logBefore, compacted, chunksAfter, logAfter };
    });
    // The failed compaction rolled back: previous snapshot and log intact.
    expect(res.compacted).toBe(false);
    expect(res.chunksAfter).toBe(res.chunksBefore);
    expect(res.logAfter).toBe(res.logBefore);
  });
});

describe('TC-25: migrate on a never-edited board (negative)', () => {
  it('writes no updates or snapshot_chunks rows', async () => {
    const res = await inBoard(freshBoardName('tc25'), (store, sql) => {
      // A fresh store: migrate only.
      store.migrate();
      const updateCount = sql.exec('SELECT COUNT(*) AS c FROM updates').one<{ c: number }>()?.c;
      const chunkCount = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one<{ c: number }>()?.c;
      return { updateCount, chunkCount };
    });
    expect(res.updateCount).toBe(0);
    expect(res.chunkCount).toBe(0);
  });
});
