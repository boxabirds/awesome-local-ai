// Story 4, task 3: BoardStore integration tests (TC-03..TC-11, TC-25).
//
// The persist.board_store contract (migrate, append, load → LoadResult,
// compactIfNeeded) is exercised against real Durable Object SQLite via
// runInDurableObject, isolated per test (unique boardId per test + isolated
// storage per file). Boards are built with the real board-model calls; a
// fresh BoardStore instance is used for each operation so the room's in-memory
// counters never interfere.

import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { BoardStore, type BoardStoreFaults, type LoadResult } from '../../src/worker/board-store';
import {
  createRetroBoard,
  mulberry32,
  phrase,
  randomBytesOfLength,
  snapshotsEqual,
} from '../fixtures/boards';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Build a board on the test side, capturing every update it produces. */
function captureBoard(create: (doc: Y.Doc) => void): {
  updates: Uint8Array[];
  doc: Y.Doc;
  snapshot: readonly StickySnapshot[];
} {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u.slice()));
  create(doc);
  return { updates, doc, snapshot: snapshot(doc) };
}

async function withStore<T>(
  boardId: string,
  fn: (store: BoardStore, state: DurableObjectState) => T,
  faults?: BoardStoreFaults,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (instance, state) => {
    void instance;
    const store = new BoardStore(state.storage, faults);
    store.migrate();
    return fn(store, state);
  });
}

function countLog(state: DurableObjectState): number {
  const r = state.storage.sql.exec<{ n: number | null }>('SELECT COUNT(*) AS n FROM updates').next();
  return r.done ? 0 : r.value.n ?? 0;
}

function chunkSizes(state: DurableObjectState): number[] {
  return state.storage.sql
    .exec<{ b: number | null }>('SELECT length(data) AS b FROM snapshot_chunks ORDER BY idx')
    .toArray()
    .map((row) => row.b ?? 0);
}

function throughSeq(state: DurableObjectState): number {
  const r = state.storage.sql
    .exec<{ v: string | null }>('SELECT value AS v FROM storage_meta WHERE key = ?1', 'snapshot_through_seq')
    .next();
  return r.done || r.value.v === null ? 0 : Number(r.value.v);
}

function countQuarantined(state: DurableObjectState): number {
  const r = state.storage.sql
    .exec<{ n: number | null }>('SELECT COUNT(*) AS n FROM quarantined_updates')
    .next();
  return r.done ? 0 : r.value.n ?? 0;
}

function appendAll(store: BoardStore, updates: Uint8Array[]): void {
  for (const update of updates) store.append(update);
}

async function loadFresh(boardId: string): Promise<{ res: LoadResult; snap: readonly StickySnapshot[] }> {
  return withStore(boardId, (store, state) => {
    const doc = new Y.Doc();
    const res = store.load(doc);
    return { res, snap: snapshot(doc) };
  });
}

describe('BoardStore (persist.board_store)', () => {
  it('TC-03: migrate + load on an empty board → tables exist, doc empty, schema version set', async () => {
    const boardId = newBoardId();
    const r = await withStore(boardId, (store, state) => {
      const doc = new Y.Doc();
      const res = store.load(doc);
      const tables = state.storage.sql
        .exec<{ name: string }>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name')
        .toArray()
        .map((row) => row.name);
      const meta: Record<string, string> = {};
      for (const row of state.storage.sql
        .exec<{ key: string; value: string }>('SELECT key, value FROM storage_meta')
        .toArray()) {
        meta[row.key] = row.value;
      }
      return { res, tables, notes: snapshot(doc).length, meta };
    });
    expect(r.res.ok).toBe(true);
    if (r.res.ok) expect(r.res.quarantined).toBe(0);
    expect(r.tables).toEqual(
      expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']),
    );
    expect(r.notes).toBe(0);
    expect(r.meta['storage_schema_version']).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('TC-04: append one update → 1 row, bytes column = length', async () => {
    const boardId = newBoardId();
    const { doc } = captureBoard((d) => {
      initDoc(d);
      createSticky(d, { x: 10, y: 20 }, 'yellow');
    });
    const update = Y.encodeStateAsUpdate(doc);
    const r = await withStore(boardId, (store, state) => {
      store.append(update);
      const row = state.storage.sql.exec<{ seq: number; bytes: number; len: number }>(
        'SELECT seq, bytes, length(data) AS len FROM updates',
      ).next();
      return { count: countLog(state), row: row.done ? null : row.value };
    });
    expect(r.count).toBe(1);
    expect(r.row).not.toBeNull();
    expect(r.row?.seq).toBe(1);
    expect(r.row?.bytes).toBe(update.length);
    expect(r.row?.len).toBe(update.length);
  });

  it('TC-05: LogOnly 25 notes → load into a fresh doc equals the original snapshot', async () => {
    const boardId = newBoardId();
    const { updates, snapshot: ref } = captureBoard((d) => {
      initDoc(d);
      createRetroBoard(d, 7);
    });
    expect(ref.length).toBe(25);
    expect(updates.length).toBe(51); // initDoc + 25 notes × (create + text)

    await withStore(boardId, (store) => appendAll(store, updates));

    const r = await loadFresh(boardId);
    expect(r.res.ok).toBe(true);
    if (r.res.ok) expect(r.res.quarantined).toBe(0);
    expect(snapshotsEqual(r.snap, ref)).toBe(true);
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows → compact: updates 0, chunks ≥ 1, through_seq = max seq, reload equal', async () => {
    const boardId = newBoardId();
    const { updates, snapshot: ref } = captureBoard((d) => {
      initDoc(d);
      createRetroBoard(d, 7);
      const t = d.getText('tc06');
      for (let i = 0; i < 450; i += 1) t.insert(t.length, 'x');
    });
    expect(ref.length).toBe(25);
    expect(updates.length).toBe(COMPACTION_UPDATE_COUNT + 1); // 1 + 50 + 450

    await withStore(boardId, (store) => appendAll(store, updates));

    const before = await withStore(boardId, (_store, state) => ({ rows: countLog(state) }));
    expect(before.rows).toBe(COMPACTION_UPDATE_COUNT + 1);

    const after = await withStore(boardId, (store, state) => {
      const doc = new Y.Doc();
      store.load(doc);
      const due = store.compactionDue();
      const compacted = store.compactIfNeeded(doc);
      return {
        due,
        compacted,
        rows: countLog(state),
        chunks: chunkSizes(state),
        through: throughSeq(state),
      };
    });
    expect(after.due).toBe(true);
    expect(after.compacted).toBe(true);
    expect(after.rows).toBe(0);
    expect(after.chunks.length).toBeGreaterThanOrEqual(1);
    expect(after.through).toBe(COMPACTION_UPDATE_COUNT + 1);

    const reloaded = await loadFresh(boardId);
    expect(reloaded.res.ok).toBe(true);
    if (reloaded.res.ok) expect(reloaded.res.quarantined).toBe(0);
    expect(snapshotsEqual(reloaded.snap, ref)).toBe(true);
  });

  it('TC-07: SnapshotPlusLog — 3 updates after compaction → reload has all; only seq > through_seq applied', async () => {
    const boardId = newBoardId();
    const { updates, snapshot: ref } = captureBoard((d) => {
      initDoc(d);
      createRetroBoard(d, 7);
      const t = d.getText('tc07');
      for (let i = 0; i < 450; i += 1) t.insert(t.length, 'x');
    });
    expect(updates.length).toBe(COMPACTION_UPDATE_COUNT + 1);

    await withStore(boardId, (store) => {
      appendAll(store, updates);
      const doc = new Y.Doc();
      store.load(doc);
      expect(store.compact(doc)).toBe(true);
    });

    // Three more updates after the snapshot.
    const more = captureBoard((d) => {
      const t = d.getText('tc07');
      for (let i = 0; i < 3; i += 1) t.insert(t.length, '.');
    });
    expect(more.updates.length).toBe(3);
    await withStore(boardId, (store) => appendAll(store, more.updates));

    const r = await withStore(boardId, (store, state) => {
      const doc = new Y.Doc();
      const res = store.load(doc);
      const through = throughSeq(state);
      const after = state.storage.sql
        .exec<{ n: number | null }>('SELECT COUNT(*) AS n FROM updates WHERE seq > ?1', through)
        .next();
      return {
        res,
        snap: snapshot(doc),
        rows: countLog(state),
        through,
        rowsAfterThrough: after.done ? 0 : after.value.n ?? 0,
      };
    });
    expect(r.res.ok).toBe(true);
    if (r.res.ok) expect(r.res.quarantined).toBe(0);
    expect(r.through).toBe(COMPACTION_UPDATE_COUNT + 1);
    expect(r.rows).toBe(3);
    expect(r.rowsAfterThrough).toBe(3);
    expect(snapshotsEqual(r.snap, ref)).toBe(true);
  });

  it('TC-08: large board compaction → multiple chunks above SNAPSHOT_CHUNK_BYTES; reload equal', async () => {
    const boardId = newBoardId();
    const { doc, snapshot: ref } = (() => {
      const d = new Y.Doc();
      initDoc(d);
      const rng = mulberry32(42);
      for (let i = 0; i < 3000; i += 1) {
        const id = createSticky(d, { x: (i % 50) * 260, y: Math.floor(i / 50) * 260 }, COLORS[i % COLORS.length]);
        const text = id === null ? undefined : getStickyText(d, id);
        text?.insert(0, phrase(rng, 10, 300));
      }
      return { doc: d, snapshot: snapshot(d) };
    })();
    expect(ref.length).toBe(3000);
    const update = Y.encodeStateAsUpdate(doc);
    // Precondition: the board spans more than one chunk.
    expect(update.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    await withStore(boardId, (store) => store.append(update));

    const after = await withStore(boardId, (store, state) => {
      const loaded = new Y.Doc();
      store.load(loaded);
      const compacted = store.compact(loaded);
      return { compacted, chunks: chunkSizes(state) };
    });
    expect(after.compacted).toBe(true);
    const total = after.chunks.reduce((a, b) => a + b, 0);
    expect(after.chunks.length).toBe(Math.ceil(total / SNAPSHOT_CHUNK_BYTES));
    expect(after.chunks.length).toBeGreaterThan(1);
    for (const size of after.chunks) expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(after.chunks[after.chunks.length - 1]).toBeLessThan(SNAPSHOT_CHUNK_BYTES);

    const reloaded = await loadFresh(boardId);
    expect(reloaded.res.ok).toBe(true);
    if (reloaded.res.ok) expect(reloaded.res.quarantined).toBe(0);
    expect(snapshotsEqual(reloaded.snap, ref)).toBe(true);
  });

  it('TC-09: overwrite log row 7 with damaged bytes → quarantined 1, row moved with error, other notes present', async () => {
    const boardId = newBoardId();
    // No initDoc: rows are 2 per note, so row 7 is note 4's creation.
    const { updates, snapshot: ref } = captureBoard((d) => createRetroBoard(d, 7));
    expect(ref.length).toBe(25);
    expect(updates.length).toBe(50);

    await withStore(boardId, (store) => appendAll(store, updates));

    await withStore(boardId, (_store, state) => {
      state.storage.sql.exec('UPDATE updates SET data = ?1 WHERE seq = ?2', randomBytesOfLength(256, 99), 7);
    });

    const r = await withStore(boardId, (store, state) => {
      const doc = new Y.Doc();
      const res = store.load(doc);
      const quarantined = state.storage.sql
        .exec<{ seq: number; error: string }>('SELECT seq, error FROM quarantined_updates ORDER BY seq')
        .toArray();
      return { res, snap: snapshot(doc), quarantined, rows: countLog(state) };
    });
    expect(r.res.ok).toBe(true);
    if (r.res.ok) expect(r.res.quarantined).toBe(1);
    expect(r.quarantined).toHaveLength(1);
    expect(r.quarantined[0].seq).toBe(7);
    expect(r.quarantined[0].error.length).toBeGreaterThan(0);
    expect(r.rows).toBe(49);
    // The damaged note (4) is lost. Because Yjs map entries form a sequence
    // chained via left-pointers, every note after the quarantined creation
    // fails to integrate as well; the notes before it (1-3) are present.
    expect(r.snap.length).toBe(3);
    const presentIds = new Set(r.snap.map((n) => n.id));
    for (const note of ref.slice(0, 3)) expect(presentIds.has(note.id)).toBe(true);
  });

  it('TC-10: corrupt snapshot chunk 0 → snapshot-unreadable; nothing deleted or quarantined', async () => {
    const boardId = newBoardId();
    const { updates } = captureBoard((d) => {
      initDoc(d);
      createRetroBoard(d, 7);
      const t = d.getText('tc10');
      for (let i = 0; i < 450; i += 1) t.insert(t.length, 'x');
    });
    expect(updates.length).toBe(COMPACTION_UPDATE_COUNT + 1);
    await withStore(boardId, (store) => {
      appendAll(store, updates);
      const doc = new Y.Doc();
      store.load(doc);
      expect(store.compact(doc)).toBe(true);
    });
    // A few log rows after the snapshot (to assert they survive the failure).
    const more = captureBoard((d) => d.getText('tc10').insert(0, 'y'));
    await withStore(boardId, (store) => appendAll(store, more.updates));

    const before = await withStore(boardId, (_s, state) => ({
      rows: countLog(state),
      chunks: chunkSizes(state),
    }));
    expect(before.rows).toBe(1);
    expect(before.chunks.length).toBeGreaterThanOrEqual(1);

    await withStore(boardId, (_store, state) => {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0', randomBytesOfLength(1024, 5));
    });

    const r = await withStore(boardId, (store, state) => {
      const doc = new Y.Doc();
      const res = store.load(doc);
      return { res, rows: countLog(state), chunks: chunkSizes(state), quarantined: countQuarantined(state) };
    });
    expect(r.res.ok).toBe(false);
    if (!r.res.ok) expect(r.res.reason).toBe('snapshot-unreadable');
    expect(r.rows).toBe(before.rows);
    // The snapshot row itself (now damaged) is intact: not deleted.
    expect(r.chunks).toHaveLength(before.chunks.length);
    expect(r.quarantined).toBe(0);
  });

  it('TC-11: a throw mid-compaction rolls back — previous chunks and log unchanged', async () => {
    const boardId = newBoardId();
    const { updates } = captureBoard((d) => {
      initDoc(d);
      createRetroBoard(d, 7);
      const t = d.getText('tc11');
      for (let i = 0; i < 450; i += 1) t.insert(t.length, 'x');
    });
    expect(updates.length).toBe(COMPACTION_UPDATE_COUNT + 1);
    await withStore(boardId, (store) => {
      appendAll(store, updates);
      const doc = new Y.Doc();
      store.load(doc);
      expect(store.compact(doc)).toBe(true);
    });
    const more = captureBoard((d) => d.getText('tc11').insert(0, 'z'));
    await withStore(boardId, (store) => appendAll(store, more.updates));

    const before = await withStore(boardId, (_s, state) => ({
      rows: countLog(state),
      chunks: chunkSizes(state),
      through: throughSeq(state),
    }));
    expect(before.rows).toBe(1);
    expect(before.through).toBe(COMPACTION_UPDATE_COUNT + 1);

    const after = await withStore(
      boardId,
      (store, state) => {
        const doc = new Y.Doc();
        store.load(doc);
        const compacted = store.compact(doc); // faults.afterSnapshotReplaced throws
        return { compacted, rows: countLog(state), chunks: chunkSizes(state), through: throughSeq(state) };
      },
      { afterSnapshotReplaced: () => { throw new Error('injected storage failure'); } },
    );
    expect(after.compacted).toBe(false);
    expect(after.rows).toBe(before.rows);
    expect(after.chunks).toEqual(before.chunks);
    expect(after.through).toBe(before.through);
  });

  it('TC-25: migrate on a never-edited board writes no updates/snapshot_chunks rows', async () => {
    const boardId = newBoardId();
    const r = await withStore(boardId, (store, state) => {
      store.migrate(); // idempotent: the constructor already migrated
      return { rows: countLog(state), chunks: chunkSizes(state), quarantined: countQuarantined(state) };
    });
    expect(r.rows).toBe(0);
    expect(r.chunks).toHaveLength(0);
    expect(r.quarantined).toBe(0);
  });
});
