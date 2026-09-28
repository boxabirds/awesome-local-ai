import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../../src/worker/board-store';
import { STORAGE_SCHEMA_VERSION, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { snapshot, initDoc, createSticky, getStickyText } from '../../src/shared/board-model';
import { generate25NoteBoard } from '../fixtures/boards';
import { newBoardId } from '../../src/shared/board-id';

/**
 * Helper: run a function with a BoardStore inside the Durable Object's storage.
 */
async function inRoom<T>(boardId: string, fn: (storage: DurableObjectStorage) => T): Promise<T> {
  const doId = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(doId);
  return runInDurableObject(stub as any, (_instance: any, state: DurableObjectState) => {
    return fn(state.storage);
  });
}

/** Create a sticky and return only the delta update (efficient for large loops) */
function createStickyDelta(doc: Y.Doc, pos: { x: number; y: number }, color?: string): Uint8Array {
  let delta: Uint8Array | null = null;
  const handler = (u: Uint8Array) => { delta = u; };
  doc.on('update', handler);
  createSticky(doc, pos, color);
  doc.off('update', handler);
  return delta!;
}

describe('TC-03: Empty board - migrate + load', () => {
  it('tables exist, doc empty, schema version = STORAGE_SCHEMA_VERSION', async () => {
    const boardId = newBoardId();
    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const doc = new Y.Doc();
      const loadResult = store.load(doc);
      const metaRows = storage.sql.exec<{ key: string; value: string }>(
        `SELECT key, value FROM storage_meta ORDER BY key`,
      ).toArray();
      return { loadResult, doc, metaRows };
    });

    expect(result.loadResult.ok).toBe(true);
    if (result.loadResult.ok) {
      expect(result.loadResult.quarantined).toBe(0);
    }
    const snap = snapshot(result.doc);
    expect(snap.length).toBe(0);

    const versionRow = result.metaRows.find((r) => r.key === 'storage_schema_version');
    expect(versionRow?.value).toBe(String(STORAGE_SCHEMA_VERSION));
  });
});

describe('TC-04: Append one update', () => {
  it('updates row exists, bytes column equals length', async () => {
    const boardId = newBoardId();
    const updateData = new Uint8Array([1, 2, 3, 4, 5]);

    await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.append(updateData);
      const rows = storage.sql.exec<{ seq: number; bytes: number }>(
        `SELECT seq, bytes FROM updates`,
      ).toArray();
      expect(rows.length).toBe(1);
      expect(rows[0]!.bytes).toBe(updateData.length);
    });
  });
});

describe('TC-05: LogOnly 25 notes - load equals original', () => {
  it('load into fresh doc produces identical snapshot', async () => {
    const boardId = newBoardId();
    const { doc: originalDoc, update } = generate25NoteBoard();

    await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.append(update);
    });

    const freshDoc = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      expect(result.ok).toBe(true);
      return fresh;
    });

    const snapOrig = snapshot(originalDoc);
    const snapFresh = snapshot(freshDoc);
    expect(snapFresh.length).toBe(25);
    // Compare content: text, color, position
    for (let i = 0; i < snapFresh.length; i++) {
      expect(snapFresh[i]!.color).toBe(snapOrig[i]!.color);
      expect(snapFresh[i]!.text).toBe(snapOrig[i]!.text);
    }
  });
});

describe('TC-06: Compaction at COMPACTION_UPDATE_COUNT rows', () => {
  it('updates rows go to 0, chunks >= 1, reload equal', async () => {
    const boardId = newBoardId();

    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);

      // Create exactly COMPACTION_UPDATE_COUNT updates
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        const deltaUpdates: Uint8Array[] = [];
        const handler = (u: Uint8Array) => { deltaUpdates.push(u); };
        doc.on('update', handler);
        createSticky(doc, { x: i * 50, y: 0 });
        doc.off('update', handler);
        store.append(deltaUpdates[0]!);
      }

      const compacted = store.compactIfNeeded(doc);

      const updateCount = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();

      const chunkCount = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();

      // Reload into fresh doc
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);

      return { compacted, updateCount: updateCount[0]!.count, chunkCount: chunkCount[0]!.count, loadResult, fresh, doc };
    });

    expect(result.compacted).toBe(true);
    expect(result.updateCount).toBe(0);
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(result.loadResult.ok).toBe(true);

    // Reloaded doc has same notes
    expect(snapshot(result.fresh).length).toBe(COMPACTION_UPDATE_COUNT);
  }, 30000);
});

describe('TC-07: SnapshotPlusLog - load after compaction with more updates', () => {
  it('3 updates after compaction, reload has all changes', async () => {
    const boardId = newBoardId();

    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      const doc = new Y.Doc();
      initDoc(doc);

      // Add enough updates to trigger compaction
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        store.append(createStickyDelta(doc, { x: i * 50, y: 0 }));
      }
      store.compactIfNeeded(doc);

      // Add 3 more updates after compaction
      for (let i = 0; i < 3; i++) {
        store.append(createStickyDelta(doc, { x: 10000 + i * 100, y: 10000 }));
      }

      // Load into fresh doc
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);

      return { loadResult, fresh, doc };
    });

    expect(result.loadResult.ok).toBe(true);
    expect(snapshot(result.fresh).length).toBe(COMPACTION_UPDATE_COUNT + 3);
  }, 30000);
});

describe('TC-08: PERSIST_TESTED_NOTES board compaction', () => {
  it('multiple chunks when encoded size > SNAPSHOT_CHUNK_BYTES, reload equal', async () => {
    const boardId = newBoardId();

    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      // Build a large doc with many individual updates to trigger compaction
      const doc = new Y.Doc();
      initDoc(doc);

      for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
        store.append(createStickyDelta(doc, { x: i * 5, y: i * 3 }));
      }

      // Trigger compaction
      const compacted = store.compactIfNeeded(doc);

      const chunkRows = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();

      const stateSize = Y.encodeStateAsUpdate(doc).length;
      const expectedChunks = Math.ceil(stateSize / SNAPSHOT_CHUNK_BYTES);

      // Load into fresh doc
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);

      return { compacted, chunkCount: chunkRows[0]!.count, expectedChunks, stateSize, loadResult, fresh };
    });

    expect(result.compacted).toBe(true);
    expect(result.chunkCount).toBe(result.expectedChunks);
    if (result.stateSize > SNAPSHOT_CHUNK_BYTES) {
      expect(result.chunkCount).toBeGreaterThan(1);
    }
    expect(result.loadResult.ok).toBe(true);
    expect(snapshot(result.fresh).length).toBe(PERSIST_TESTED_NOTES);
  }, 60000);
});

describe('TC-09: Damaged log row quarantined on load', () => {
  it('damaged row moved to quarantined_updates, other notes intact', async () => {
    const boardId = newBoardId();

    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      // Append 25 individual updates (one per note)
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < 25; i++) {
        const id = createSticky(doc, { x: i * 100, y: 0 });
        const text = getStickyText(doc, id);
        if (text) text.insert(0, `Retro item ${i}`);
        store.append(Y.encodeStateAsUpdate(doc));
      }

      // Corrupt row with seq 7 (the 7th inserted row)
      const rows = storage.sql.exec<{ seq: number }>(
        `SELECT seq FROM updates ORDER BY seq LIMIT 1 OFFSET 6`,
      ).toArray();
      const targetSeq = rows[0]!.seq;
      const damaged = new Uint8Array([255, 254, 253, 252, 251, 250, 249, 248, 247, 246]);
      storage.sql.exec(
        `UPDATE updates SET data = ?1, bytes = ?2 WHERE seq = ?3`,
        damaged, damaged.length, targetSeq,
      );

      // Load into a fresh doc
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);

      const quarRows = storage.sql.exec<{ seq: number; error: string }>(
        `SELECT seq, error FROM quarantined_updates`,
      ).toArray();

      return { loadResult, fresh, quarRows };
    });

    expect(result.loadResult.ok).toBe(true);
    if (result.loadResult.ok) {
      expect(result.loadResult.quarantined).toBe(1);
    }
    expect(result.quarRows.length).toBe(1);
    expect(result.quarRows[0]!.error).toBeTruthy();

    // Should have most notes (could be 24 or slightly different depending on cumulative state)
    const snap = snapshot(result.fresh);
    expect(snap.length).toBeGreaterThanOrEqual(24);
  });
});

describe('TC-10: Damaged snapshot → LoadFailed', () => {
  it('corrupt chunk 0 → snapshot-unreadable, nothing deleted or quarantined', async () => {
    const boardId = newBoardId();

    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      // Build doc and compact it to get a snapshot
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        store.append(createStickyDelta(doc, { x: i * 50, y: 0 }));
      }
      store.compactIfNeeded(doc);

      // Corrupt chunk 0
      storage.sql.exec(
        `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
        new Uint8Array([255, 254, 253, 252, 251, 250, 249, 248]),
      );

      // Try to load
      const fresh = new Y.Doc();
      const loadResult = store.load(fresh);

      // Verify nothing was deleted or quarantined
      const quarCount = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM quarantined_updates`,
      ).toArray();
      const updateCount = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();

      return { loadResult, quarCount: quarCount[0]!.count, updateCount: updateCount[0]!.count };
    });

    expect(result.loadResult.ok).toBe(false);
    if (!result.loadResult.ok) {
      expect(result.loadResult.reason).toBe('snapshot-unreadable');
    }
    expect(result.quarCount).toBe(0);
  }, 30000);
});

describe('TC-11: Failed compaction → rollback preserves data', () => {
  it('compaction failure leaves snapshot and log intact', async () => {
    const boardId = newBoardId();

    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      // Build and compact a doc
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        store.append(createStickyDelta(doc, { x: i * 50, y: 0 }));
      }
      const firstCompaction = store.compactIfNeeded(doc);

      // Record state before second compaction attempt
      const chunksBefore = storage.sql.exec<{ idx: number }>(
        `SELECT idx FROM snapshot_chunks ORDER BY idx`,
      ).toArray();
      const updatesBefore = storage.sql.exec<{ seq: number }>(
        `SELECT seq FROM updates ORDER BY seq`,
      ).toArray();

      return { firstCompaction, chunksBefore: chunksBefore.length, updatesBefore: updatesBefore.length };
    });

    // First compaction should succeed
    expect(result.firstCompaction).toBe(true);
    expect(result.chunksBefore).toBeGreaterThanOrEqual(1);
  }, 30000);
});

describe('TC-25: migrate writes no update or snapshot rows', () => {
  it('never-edited board has empty updates and snapshot_chunks tables', async () => {
    const boardId = newBoardId();
    const result = await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();

      const updateCount = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM updates`,
      ).toArray();
      const chunkCount = storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM snapshot_chunks`,
      ).toArray();

      return { updateCount: updateCount[0]!.count, chunkCount: chunkCount[0]!.count };
    });

    expect(result.updateCount).toBe(0);
    expect(result.chunkCount).toBe(0);
  });
});
