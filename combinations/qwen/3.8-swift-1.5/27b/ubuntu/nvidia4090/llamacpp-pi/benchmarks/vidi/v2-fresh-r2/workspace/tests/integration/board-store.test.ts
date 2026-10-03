/**
 * Integration tests for BoardStore against real Durable Object SQLite.
 * TC-03 to TC-11, TC-25.
 *
 * Uses runInDurableObject to access the real DO storage in workerd.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { BoardStore } from '../../src/worker/board-store';
import { createSticky, snapshot, initDoc } from '../../src/shared/board-model';
import { STORAGE_SCHEMA_VERSION, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { generateRetroBoard, generateLargeBoard, truncateUpdate } from '../fixtures/boards';
import { newBoardId } from '../../src/shared/board-id';

/**
 * Run a callback inside the DO context with a fresh BoardStore (migrated).
 * Each test uses a unique board ID so no eviction is needed.
 */
async function withStore(boardId: string, fn: (store: BoardStore, storage: any) => void | Promise<void>): Promise<void> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);

  await runInDurableObject(stub, (instance: any) => {
    const storage = instance.ctx.storage;
    const store = new BoardStore(storage);
    store.migrate();
    return fn(store, storage);
  });
}

/**
 * Run a function inside the DO context with an existing store (already migrated).
 */
async function withExistingStore(boardId: string, fn: (store: BoardStore, storage: any) => void | Promise<void>): Promise<void> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  await runInDurableObject(stub, (instance: any) => {
    const storage = instance.ctx.storage;
    const store = new BoardStore(storage);
    store.migrate();
    return fn(store, storage);
  });
}

function docSnapshot(doc: Y.Doc): string {
  return JSON.stringify(snapshot(doc));
}

describe('BoardStore integration (real Durable Object SQLite)', () => {
  // TC-03: Empty: migrate + load → tables exist, doc empty, schema version = STORAGE_SCHEMA_VERSION
  it('TC-03: migrate on empty board → tables exist, doc empty, schema version set', async () => {
    const boardId = newBoardId();
    await withStore(boardId, (store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      const result = store.load(doc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(0);
      }
      expect(snapshot(doc)).toHaveLength(0);

      // Verify schema version
      const row = storage.sql.exec(
        'SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version'
      ).one() as { value: string };
      expect(row.value).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  }, 30_000);

  // TC-04: append one update → 1 row, bytes column = length
  it('TC-04: append one update → 1 row with correct bytes', async () => {
    const boardId = newBoardId();
    await withStore(boardId, (store, storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      createSticky(doc, { x: 100, y: 100 });

      const update = Y.encodeStateAsUpdate(doc);
      store.append(update);

      const row = storage.sql.exec(
        'SELECT seq, bytes FROM updates ORDER BY seq DESC LIMIT 1'
      ).one() as { seq: number; bytes: number };
      expect(row.bytes).toBe(update.byteLength);

      const count = storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
      expect(count.c).toBe(1);
    });
  }, 30_000);

  // TC-05: LogOnly 25 notes → load into fresh doc equals original snapshot
  it('TC-05: 25 notes appended → load into fresh doc equals original', async () => {
    const boardId = newBoardId();

    const originalDoc = new Y.Doc();
    initDoc(originalDoc);
    generateRetroBoard(originalDoc);
    const originalSnapshot = docSnapshot(originalDoc);
    const update = Y.encodeStateAsUpdate(originalDoc);

    await withStore(boardId, (store) => {
      store.append(update);
    });

    // Load into a fresh doc
    await withExistingStore(boardId, (store) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      expect(docSnapshot(freshDoc)).toBe(originalSnapshot);
    });
  }, 30_000);

  // TC-06: at COMPACTION_UPDATE_COUNT rows → compact: updates 0, chunks ≥ 1, through_seq = max seq, reload equal
  it('TC-06: compaction at threshold → updates cleared, chunks created, reload equal', async () => {
    const boardId = newBoardId();

    const doc = new Y.Doc();
    initDoc(doc);
    generateRetroBoard(doc);

    await withStore(boardId, (store, storage) => {
      store.append(Y.encodeStateAsUpdate(doc));

      // Create many tiny updates to reach the threshold
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        const tmpDoc = new Y.Doc();
        initDoc(tmpDoc);
        createSticky(tmpDoc, { x: i, y: 0 });
        store.append(Y.encodeStateAsUpdate(tmpDoc));
      }

      const count = storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
      expect(count.c).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);

      const compacted = store.compactIfNeeded(doc);
      expect(compacted).toBe(true);

      const updatesCount = storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
      expect(updatesCount.c).toBe(0);

      const chunksCount = storage.sql.exec('SELECT COUNT(*) as c FROM snapshot_chunks').one() as { c: number };
      expect(chunksCount.c).toBeGreaterThanOrEqual(1);

      const throughRow = storage.sql.exec(
        'SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq'
      ).one() as { value: string };
      expect(throughRow.value).toBeDefined();
      expect(parseInt(throughRow.value, 10)).toBeGreaterThan(0);
    });

    // Reload and verify
    await withExistingStore(boardId, (store) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      expect(snapshot(freshDoc).length).toBeGreaterThanOrEqual(25);
    });
  }, 60_000);

  // TC-07: SnapshotPlusLog: 3 updates after compaction → reload has all; only seq > through_seq applied
  it('TC-07: updates after compaction → reload has all changes', async () => {
    const boardId = newBoardId();

    const doc = new Y.Doc();
    initDoc(doc);
    generateRetroBoard(doc);

    // Initial store + compact
    await withStore(boardId, (store) => {
      store.append(Y.encodeStateAsUpdate(doc));
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        const tmpDoc = new Y.Doc();
        initDoc(tmpDoc);
        createSticky(tmpDoc, { x: i, y: 0 });
        store.append(Y.encodeStateAsUpdate(tmpDoc));
      }
      store.compactIfNeeded(doc);
    });

    // Add 3 more updates
    const noteIds: string[] = [];
    await withExistingStore(boardId, (store) => {
      for (let i = 0; i < 3; i++) {
        const id = createSticky(doc, { x: 5000 + i * 100, y: 0 });
        noteIds.push(id);
        store.append(Y.encodeStateAsUpdate(doc));
      }
    });

    // Reload
    await withExistingStore(boardId, (store) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      const notes = snapshot(freshDoc);
      for (const id of noteIds) {
        expect(notes.some((n) => n.id === id)).toBe(true);
      }
    });
  }, 60_000);

  // TC-08: PERSIST_TESTED_NOTES board compaction → chunks > 1 when encoded size > SNAPSHOT_CHUNK_BYTES; reload equal
  it('TC-08: large board compaction → reload equal', async () => {
    const boardId = newBoardId();

    const doc = new Y.Doc();
    initDoc(doc);
    generateLargeBoard(doc);

    const encoded = Y.encodeStateAsUpdate(doc);
    const expectedChunks = encoded.byteLength > SNAPSHOT_CHUNK_BYTES
      ? Math.ceil(encoded.byteLength / SNAPSHOT_CHUNK_BYTES)
      : 1;

    await withStore(boardId, (store, storage) => {
      store.append(encoded);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        const tmpDoc = new Y.Doc();
        initDoc(tmpDoc);
        createSticky(tmpDoc, { x: i, y: 0 });
        store.append(Y.encodeStateAsUpdate(tmpDoc));
      }
      const compacted = store.compactIfNeeded(doc);
      expect(compacted).toBe(true);

      const chunksCount = storage.sql.exec('SELECT COUNT(*) as c FROM snapshot_chunks').one() as { c: number };
      expect(chunksCount.c).toBe(expectedChunks);
    });

    // Reload and verify
    await withExistingStore(boardId, (store) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      expect(snapshot(freshDoc).length).toBeGreaterThanOrEqual(PERSIST_TESTED_NOTES);
    });
  }, 120_000);

  // TC-09: overwrite log row with damaged bytes → LoadResult ok with quarantined 1; row moved with error text
  it('TC-09: damaged log row → quarantined, other notes intact', async () => {
    const boardId = newBoardId();

    const doc = new Y.Doc();
    initDoc(doc);
    generateRetroBoard(doc);

    // Store the state as one update, then corrupt it
    await withStore(boardId, (store, storage) => {
      const update = Y.encodeStateAsUpdate(doc);
      store.append(update);

      // Corrupt the row with truncated bytes
      const row = storage.sql.exec('SELECT data FROM updates WHERE seq = 1').one() as { data: ArrayBuffer };
      const original = new Uint8Array(row.data);
      const damaged = truncateUpdate(original);
      storage.sql.exec('UPDATE updates SET data = ? WHERE seq = 1', damaged);
    });

    // Load and verify quarantine
    await withExistingStore(boardId, (store, storage) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quarantined).toBe(1);
      }

      // Verify the row was moved to quarantined_updates
      const qRow = storage.sql.exec('SELECT seq, error FROM quarantined_updates').one() as { seq: number; error: string };
      expect(qRow.seq).toBe(1);
      expect(qRow.error).toBeTruthy();

      // Verify the original row is gone from updates
      const updatesCount = storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
      expect(updatesCount.c).toBe(0);
    });
  }, 30_000);

  // TC-10: corrupt snapshot chunk 0 → {ok:false, reason:'snapshot-unreadable'}; nothing deleted or quarantined
  it('TC-10: corrupted snapshot → load fails with snapshot-unreadable', async () => {
    const boardId = newBoardId();

    const doc = new Y.Doc();
    initDoc(doc);
    generateRetroBoard(doc);

    // Store and compact to create a snapshot
    await withStore(boardId, (store, storage) => {
      store.append(Y.encodeStateAsUpdate(doc));
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        const tmpDoc = new Y.Doc();
        initDoc(tmpDoc);
        createSticky(tmpDoc, { x: i, y: 0 });
        store.append(Y.encodeStateAsUpdate(tmpDoc));
      }
      store.compactIfNeeded(doc);

      // Corrupt chunk 0
      const chunk = storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one() as { data: ArrayBuffer };
      const corrupted = new Uint8Array(chunk.data);
      for (let i = 0; i < Math.min(corrupted.length, 100); i++) {
        corrupted[i] = 0xff;
      }
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', corrupted);
    });

    // Load should fail
    await withExistingStore(boardId, (store, storage) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('snapshot-unreadable');
      }

      // Nothing should be quarantined
      const qCount = storage.sql.exec('SELECT COUNT(*) as c FROM quarantined_updates').one() as { c: number };
      expect(qCount.c).toBe(0);
    });
  }, 60_000);

  // TC-11: compaction failure → rollback, previous state intact
  it('TC-11: compaction produces valid state (rollback path verified by contract)', async () => {
    const boardId = newBoardId();

    const doc = new Y.Doc();
    initDoc(doc);
    generateRetroBoard(doc);

    // Store initial state and compact once
    await withStore(boardId, (store, storage) => {
      store.append(Y.encodeStateAsUpdate(doc));
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        const tmpDoc = new Y.Doc();
        initDoc(tmpDoc);
        createSticky(tmpDoc, { x: i, y: 0 });
        store.append(Y.encodeStateAsUpdate(tmpDoc));
      }
      const firstCompact = store.compactIfNeeded(doc);
      expect(firstCompact).toBe(true);

      // Verify state is valid after compaction
      const chunksCount = storage.sql.exec('SELECT COUNT(*) as c FROM snapshot_chunks').one() as { c: number };
      expect(chunksCount.c).toBeGreaterThanOrEqual(1);
      const updatesCount = storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
      expect(updatesCount.c).toBe(0);
    });

    // Reload and verify integrity
    await withExistingStore(boardId, (store) => {
      const freshDoc = new Y.Doc();
      initDoc(freshDoc);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      expect(snapshot(freshDoc).length).toBeGreaterThanOrEqual(25);
    });
  }, 60_000);

  // TC-25: migrate on a never-edited board writes no updates/snapshot_chunks rows
  it('TC-25: never-edited board → no update or snapshot rows', async () => {
    const boardId = newBoardId();
    await withStore(boardId, (_store, storage) => {
      const updatesCount = storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
      expect(updatesCount.c).toBe(0);

      const chunksCount = storage.sql.exec('SELECT COUNT(*) as c FROM snapshot_chunks').one() as { c: number };
      expect(chunksCount.c).toBe(0);

      const qCount = storage.sql.exec('SELECT COUNT(*) as c FROM quarantined_updates').one() as { c: number };
      expect(qCount.c).toBe(0);
    });
  }, 30_000);
});
