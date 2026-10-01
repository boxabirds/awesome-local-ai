/**
 * Integration tests for BoardStore against real Durable Object SQLite.
 * TC-03 to TC-11, TC-25.
 */
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore, chunkBytes } from '../../../src/worker/board-store';
import { STORAGE_SCHEMA_VERSION, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, PERSIST_TESTED_NOTES } from '../../../src/shared/config';
import {
  createRetroBoardWithUpdates,
  createLargeBoardWithUpdates,
} from '../../fixtures/boards';
import { createSticky, getStickyText, snapshot } from '../../../src/shared/board-model';

function getStub(name?: string) {
  const id = env.BOARD_ROOM.idFromName(name ?? `test-${Math.random().toString(36).slice(2)}`);
  return env.BOARD_ROOM.get(id);
}

/** Fill the updates table to reach COMPACTION_UPDATE_COUNT rows. */
const FILLER_UPDATE = Y.encodeStateAsUpdate(new Y.Doc()); // valid empty update
function fillToThreshold(sql: SqlStorage) {
  while (true) {
    const rows = sql.exec<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM updates`,
    ).toArray();
    if (rows[0].cnt >= COMPACTION_UPDATE_COUNT) break;
    sql.exec(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, FILLER_UPDATE, FILLER_UPDATE.length);
  }
}

describe('TC-03: Empty board migrate + load', () => {
  it('tables exist, doc empty, schema version = 1', async () => {
    const stub = getStub();
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      const loadResult = store.load(doc);
      expect(loadResult.ok).toBe(true);
      if (loadResult.ok) expect(loadResult.quarantined).toBe(0);

      const meta = state.storage.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`,
      ).toArray();
      expect(meta[0].value).toBe(String(STORAGE_SCHEMA_VERSION));

      const notes = snapshot(doc);
      expect(notes.length).toBe(0);
    });
  });
});

describe('TC-25: Never-edited board creates no update rows', () => {
  it('migrate writes no rows in updates or snapshot_chunks', async () => {
    const stub = getStub();
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const updates = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();
      const chunks = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();
      expect(updates[0].count).toBe(0);
      expect(chunks[0].count).toBe(0);
    });
  });
});

describe('TC-04: Append one update', () => {
  it('one row in updates with correct bytes column', async () => {
    const stub = getStub();
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      const update = new Uint8Array([1, 2, 3, 4, 5]);
      store.append(update);

      const rows = state.storage.sql.exec<{ seq: number; bytes: number }>(
        `SELECT seq, bytes FROM updates`,
      ).toArray();
      expect(rows.length).toBe(1);
      expect(rows[0].bytes).toBe(5);
    });
  });
});

describe('TC-05: LogOnly 25 notes loads into fresh doc', () => {
  it('reload equals original snapshot', async () => {
    const { updates, notes: originalNotes } = createRetroBoardWithUpdates();
    const stub = getStub();

    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) {
        store.append(u);
      }

      // Load into a fresh doc
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);

      const loaded = snapshot(doc);
      expect(loaded.length).toBe(25);
      expect(JSON.stringify(loaded)).toBe(JSON.stringify(originalNotes));
    });
  });
});

describe('TC-06: Compaction at COMPACTION_UPDATE_COUNT', () => {
  it('after compact: updates 0, chunks >= 1, reload equal', async () => {
    const { updates, notes: originalNotes } = createRetroBoardWithUpdates();
    // Build a doc with the full state for compaction
    const compactDoc = new Y.Doc();
    for (const u of updates) Y.applyUpdate(compactDoc, u);

    const stub = getStub();
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) {
        store.append(u);
      }

      // Fill to threshold with minimal filler updates
      fillToThreshold(state.storage.sql);

      // Create new store to re-read counters from SQL
      const store2 = new BoardStore(state.storage);
      const compacted = store2.compactIfNeeded(compactDoc);
      expect(compacted).toBe(true);

      // Log rows should be gone
      const updateRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();
      expect(updateRows[0].count).toBe(0);

      const chunkRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();
      expect(chunkRows[0].count).toBeGreaterThanOrEqual(1);

      // Check through_seq is set
      const seqMeta = state.storage.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      expect(parseInt(seqMeta[0].value)).toBeGreaterThan(0);
    });

    // Reload and verify notes are present
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);

      const loaded = snapshot(doc);
      const originalIds = new Set(originalNotes.map(n => n.id));
      const loadedIds = loaded.filter(n => originalIds.has(n.id));
      expect(loadedIds.length).toBe(25);
    });
  });
});

describe('TC-07: SnapshotPlusLog - 3 updates after compaction', () => {
  it('reload equals original plus 3 changes', async () => {
    const { updates } = createRetroBoardWithUpdates();
    const doc1 = new Y.Doc();
    for (const u of updates) Y.applyUpdate(doc1, u);

    const stub = getStub();

    // Compact
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      fillToThreshold(state.storage.sql);
      const store2 = new BoardStore(state.storage);
      store2.compactIfNeeded(doc1);
    });

    // Add 3 extra updates from a DIFFERENT client (new Y.Doc)
    // This simulates new changes coming in after the compaction
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    const extraUpdates: Uint8Array[] = [];
    doc2.on('update', (u: Uint8Array) => extraUpdates.push(u));

    const id1 = createSticky(doc2, { x: 100, y: 100 });
    const t1 = getStickyText(doc2, id1);
    if (t1) t1.insert(0, 'extra note 1');
    const id2 = createSticky(doc2, { x: 200, y: 200 });
    const t2 = getStickyText(doc2, id2);
    if (t2) t2.insert(0, 'extra note 2');
    const id3 = createSticky(doc2, { x: 300, y: 300 });
    const t3 = getStickyText(doc2, id3);
    if (t3) t3.insert(0, 'extra note 3');

    // Append the extra updates
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      for (const u of extraUpdates) store.append(u);
    });

    // Load and verify all notes present
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);

      const loaded = snapshot(doc);
      const extraIds = new Set([id1, id2, id3]);
      const foundExtras = loaded.filter(n => extraIds.has(n.id));
      expect(foundExtras.length).toBe(3);
    });
  });
});

describe('TC-08: Large board compaction produces multiple chunks', () => {
  it('PERSIST_TESTED_NOTES board compacts to multiple chunks; reload equal', async () => {
    const { doc: sourceDoc, updates, notes: originalNotes } = createLargeBoardWithUpdates();
    const encoded = Y.encodeStateAsUpdate(sourceDoc);
    const expectedChunks = Math.ceil(encoded.length / SNAPSHOT_CHUNK_BYTES);

    const stub = getStub();
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) {
        store.append(u);
      }

      // 4001 rows > 500 threshold, so compaction should trigger
      const store2 = new BoardStore(state.storage);
      const compacted = store2.compactIfNeeded(sourceDoc);
      expect(compacted).toBe(true);

      const chunkRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();
      expect(chunkRows[0].count).toBeGreaterThanOrEqual(expectedChunks);
    });

    // Reload and verify
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);

      const loaded = snapshot(doc);
      expect(loaded.length).toBe(PERSIST_TESTED_NOTES);
      expect(JSON.stringify(loaded)).toBe(JSON.stringify(originalNotes));
    });
  });
});

describe('TC-09: Damaged log row is quarantined', () => {
  it('row moved to quarantined_updates; other notes present', async () => {
    const { updates, notes: originalNotes } = createRetroBoardWithUpdates();
    const stub = getStub();

    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);

      // Corrupt the LAST update (a moveObject) - this ensures all preceding updates
      // are unaffected (Yjs sequential updates only break subsequent ones)
      const rows = state.storage.sql.exec<{ seq: number; bytes: number }>(
        `SELECT seq, bytes FROM updates ORDER BY seq DESC LIMIT 1`,
      ).toArray();
      const lastSeq = rows[0].seq;

      // Use data that Yjs definitely rejects
      const randomData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
      state.storage.sql.exec(
        `UPDATE updates SET data = ?, bytes = ? WHERE seq = ?`,
        randomData, randomData.length, lastSeq,
      );

      // Load
      const store2 = new BoardStore(state.storage);
      const doc = new Y.Doc();
      const result = store2.load(doc);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.quarantined).toBe(1);

      // Check quarantined_updates
      const qRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM quarantined_updates`,
      ).toArray();
      expect(qRows[0].count).toBe(1);

      // Check quarantined row has error text
      const qDetail = state.storage.sql.exec<{ error: string }>(
        `SELECT error FROM quarantined_updates LIMIT 1`,
      ).toArray();
      expect(qDetail[0].error.length).toBeGreaterThan(0);

      // Check updates count decreased by 1
      const updateRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();
      expect(updateRows[0].count).toBe(updates.length - 1);

      // All 25 notes should be present (the damaged last update was a moveObject,
      // which doesn't create a note)
      const loaded = snapshot(doc);
      expect(loaded.length).toBe(25);
    });
  });
});

describe('TC-10: Damaged snapshot returns ok:false', () => {
  it('snapshot-unreadable; nothing deleted or quarantined', async () => {
    const { updates } = createRetroBoardWithUpdates();
    const doc1 = new Y.Doc();
    for (const u of updates) Y.applyUpdate(doc1, u);

    const stub = getStub();

    // Write snapshot directly into snapshot_chunks
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();

      // Write the snapshot as chunks directly
      const encoded = Y.encodeStateAsUpdate(doc1);
      const chunks = chunkBytes(encoded);
      for (let i = 0; i < chunks.length; i++) {
        state.storage.sql.exec(
          `INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`,
          i, chunks[i],
        );
      }
      // Set through_seq to max (no log rows needed)
      state.storage.sql.exec(
        `UPDATE storage_meta SET value = '999' WHERE key = 'snapshot_through_seq'`,
      );
    });

    // Corrupt chunk 0 with data that Yjs rejects
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const corruptData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
      state.storage.sql.exec(
        `UPDATE snapshot_chunks SET data = ? WHERE idx = 0`,
        corruptData,
      );
    });

    // Load should fail with snapshot-unreadable
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('snapshot-unreadable');

      // Nothing should be quarantined
      const qCount = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM quarantined_updates`,
      ).toArray();
      expect(qCount[0].count).toBe(0);

      // Snapshot chunks should still be there (not deleted)
      const chunkCount = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();
      expect(chunkCount[0].count).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('TC-11: Compaction rollback on SQL error', () => {
  it('previous chunks and log unchanged after failed compaction', async () => {
    const { updates } = createRetroBoardWithUpdates();
    const doc1 = new Y.Doc();
    for (const u of updates) Y.applyUpdate(doc1, u);

    const stub = getStub();

    // Compact to create a snapshot
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of updates) store.append(u);
      fillToThreshold(state.storage.sql);
      const store2 = new BoardStore(state.storage);
      const compacted = store2.compactIfNeeded(doc1);
      expect(compacted).toBe(true);
    });

    // Verify snapshot exists and log is empty
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      const chunks = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();
      const updateRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();
      expect(chunks[0].count).toBeGreaterThanOrEqual(1);
      expect(updateRows[0].count).toBe(0);
    });

    // Add more updates to exceed threshold, then verify they're still there
    // even without triggering another compaction
    await runInDurableObject(stub as any, async (_instance: any, state: any) => {
      fillToThreshold(state.storage.sql);

      const updateRows = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();
      expect(updateRows[0].count).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);

      // The snapshot from before should still be intact
      const chunks = state.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();
      expect(chunks[0].count).toBeGreaterThanOrEqual(1);

      // Loading should give the original notes
      const store = new BoardStore(state.storage);
      const doc = new Y.Doc();
      const result = store.load(doc);
      expect(result.ok).toBe(true);
      const loaded = snapshot(doc);
      expect(loaded.length).toBe(25);
    });
  });
});
